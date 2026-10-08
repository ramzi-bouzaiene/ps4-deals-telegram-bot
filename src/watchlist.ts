import fs from "fs";
import { notify, enqueue, flushDigest, esc } from "./telegram";
import { fetchWithRetry, sleep } from "./http";

export type Item = { name: string; url: string; target: number };
export type Price = { current: number | null; base: number | null; free: boolean };
export type FetchResult =
  { ok: true; price: Price } | { ok: false; reason: string; broke: boolean };

type State = Record<
  string,
  {
    url?: string;
    lastAlerted?: number;
    lastPct?: number;
    lastBreak?: string;
    low?: number;
    high?: number;
    history: { t: string; price: number }[];
  }
>;

const STATE_FILE = "docs/prices.json";
const META_FILE = "docs/meta.json";
const DEBUG = process.env.DEBUG === "1";
const MIN_DISCOUNT = Number(process.env.MIN_DISCOUNT ?? 50);
const BREAK_ALERT_COOLDOWN_MS = 24 * 3600 * 1000;

const state: State = fs.existsSync(STATE_FILE)
  ? JSON.parse(fs.readFileSync(STATE_FILE, "utf8"))
  : {};

export function loadItems(): Item[] {
  return JSON.parse(fs.readFileSync("watchlist.json", "utf8"));
}

export function saveItems(items: Item[]) {
  fs.writeFileSync("watchlist.json", JSON.stringify(items, null, 2) + "\n");
}

export const toNumber = (s: unknown): number | null => {
  if (typeof s === "number") return s;
  if (typeof s !== "string") return null;
  const m = s.replace(/\s/g, "").match(/[\d.,]+/);
  if (!m) return null;
  let n = m[0];
  // handle "1.234,56" vs "1,234.56"
  if (n.includes(",") && n.includes(".")) {
    n =
      n.lastIndexOf(",") > n.lastIndexOf(".")
        ? n.replace(/\./g, "").replace(",", ".")
        : n.replace(/,/g, "");
  } else if (n.includes(",")) n = n.replace(",", ".");
  const v = parseFloat(n);
  return Number.isFinite(v) ? v : null;
};

// Walk the embedded JSON and collect every object that looks like a price block.
function collectPrices(node: any, out: any[] = []): any[] {
  if (Array.isArray(node)) node.forEach((n) => collectPrices(n, out));
  else if (node && typeof node === "object") {
    if ("discountedPrice" in node || "basePrice" in node) out.push(node);
    Object.values(node).forEach((v) => collectPrices(v, out));
  }
  return out;
}

// Price data also lives inside HTML strings (batarangs.*.text) as embedded
// <script type="application/json"> blobs — collect those too.
function collectEmbedded(node: any, out: any[] = []): any[] {
  if (Array.isArray(node)) node.forEach((n) => collectEmbedded(n, out));
  else if (node && typeof node === "object") {
    for (const v of Object.values(node)) {
      if (typeof v === "string" && v.includes("<script")) {
        for (const m of v.matchAll(
          /<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/g,
        )) {
          try {
            collectPrices(JSON.parse(m[1]), out);
            collectEmbedded(JSON.parse(m[1]), out);
          } catch {
            /* ignore unparsable blob */
          }
        }
      } else if (v && typeof v === "object") collectEmbedded(v, out);
    }
  }
  return out;
}

type Candidate = { cur: number; base: number | null; free: boolean };

function toCandidate(b: any): Candidate | null {
  const branding: string[] = Array.isArray(b.serviceBranding) ? b.serviceBranding : [];
  const disp = typeof b.discountedPrice === "string" ? b.discountedPrice : "";
  // "Inclus" = bundled with PS Plus subscription, not a real purchase price.
  if (/inclus/i.test(disp)) return null;
  if (
    b.discountedValue === 0 &&
    typeof b.displayUpsellText === "string" &&
    /abonn/i.test(b.displayUpsellText)
  )
    return null;
  const free =
    b.isFree === true ||
    (/gratuit/i.test(disp) && !/abonn/i.test(String(b.displayUpsellText ?? ""))) ||
    (typeof b.discountedValue === "number" &&
      b.discountedValue === 0 &&
      branding.every((x) => x === "NONE"));
  const cur = free
    ? 0
    : typeof b.discountedValue === "number"
      ? b.discountedValue / 100
      : (toNumber(disp) ?? toNumber(b.basePrice));
  if (cur === null) return null;
  const base =
    typeof b.basePriceValue === "number" ? b.basePriceValue / 100 : toNumber(b.basePrice);
  return { cur, base: base !== null && base >= cur ? base : null, free: free || cur === 0 };
}

export async function fetchPrice(url: string): Promise<FetchResult> {
  let res: Response;
  try {
    res = await fetchWithRetry(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ps-deals-bot/1.0)",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
  } catch (e) {
    return { ok: false, reason: (e as Error).message, broke: false };
  }
  if (!res.ok) {
    console.error("HTTP", res.status, url);
    return { ok: false, reason: `HTTP ${res.status}`, broke: false };
  }
  const html = await res.text();
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) {
    return {
      ok: false,
      reason: "No __NEXT_DATA__ found, page structure may have changed",
      broke: true,
    };
  }
  let blocks: any[];
  try {
    const data = JSON.parse(m[1]);
    blocks = [...collectPrices(data), ...collectEmbedded(data)];
  } catch (e) {
    return { ok: false, reason: `Bad __NEXT_DATA__ JSON: ${(e as Error).message}`, broke: true };
  }
  if (DEBUG) console.log(JSON.stringify(blocks.slice(0, 5), null, 2));

  const pairs = blocks
    .map((b) => ({ b, c: toCandidate(b) }))
    .filter((p): p is { b: any; c: Candidate } => p.c !== null);
  if (!pairs.length) return { ok: false, reason: "No price blocks in page", broke: true };
  // Prefer standard (non-bundled) purchase blocks; fall back to any.
  const std = pairs.filter(
    (p) =>
      !Array.isArray(p.b.serviceBranding) || p.b.serviceBranding.every((x: string) => x === "NONE"),
  );
  const pool = std.length ? std : pairs;
  const best = pool.reduce((a, b) => (b.c.cur < a.c.cur ? b : a));
  return {
    ok: true,
    price: { current: best.c.cur, base: best.c.base, free: best.c.free },
  };
}

function discountPct(p: Price): number {
  if (p.base === null || p.base <= p.current!) return 0;
  return Math.round((1 - p.current! / p.base) * 100);
}

async function alertBreak(name: string, url: string, reason: string) {
  const s = (state[name] ??= { history: [] });
  const now = Date.now();
  const last = s.lastBreak ? Date.parse(s.lastBreak) : 0;
  if (now - last < BREAK_ALERT_COOLDOWN_MS) return;
  s.lastBreak = new Date(now).toISOString();
  await notify(
    `⚠️ <b>Scraper broke</b> for ${esc(name)}\n${esc(reason)}\nRun \`npm run debug\` locally and adjust fetchPrice in src/watchlist.ts\n${url}`,
  );
}

function writeMeta(extra: Record<string, unknown> = {}) {
  fs.mkdirSync("docs", { recursive: true });
  const prev = fs.existsSync(META_FILE) ? JSON.parse(fs.readFileSync(META_FILE, "utf8")) : {};
  fs.writeFileSync(
    META_FILE,
    JSON.stringify({ ...prev, lastRun: new Date().toISOString(), ...extra }, null, 2),
  );
}

export async function checkWatchlist() {
  fs.mkdirSync("docs", { recursive: true });
  const items: Item[] = loadItems();
  let checked = 0;

  for (const item of items) {
    const r = await fetchPrice(item.url);
    await sleep(3000); // be polite
    checked++;

    if (!r.ok) {
      if (r.broke) await alertBreak(item.name, item.url, r.reason);
      else console.error("Fetch failed:", item.name, r.reason);
      continue;
    }
    const p = r.price;
    if (p.current === null) continue;

    const s = (state[item.name] ??= { history: [] });
    s.url = item.url;
    delete s.lastBreak;
    const last = s.history.at(-1);
    if (!last || last.price !== p.current)
      s.history.push({ t: new Date().toISOString(), price: p.current });
    s.history = s.history.slice(-500);

    const pct = discountPct(p);
    const previousLow = s.low;
    const isNewLow = previousLow !== undefined && p.current < previousLow;
    if (previousLow === undefined || p.current < previousLow) s.low = p.current;
    if (s.high === undefined || p.current > s.high) s.high = p.current;

    const belowTarget = p.current <= item.target;
    const newLowAlert = s.lastAlerted === undefined || p.current < s.lastAlerted;
    // Alert the first time a game is seen free (or becomes free again), not
    // on every run while it stays free — s.lastAlerted is 0 while free.
    const becameFree = p.free && s.lastAlerted !== 0;

    const urgent = (belowTarget && newLowAlert) || isNewLow || becameFree;
    const pctAlert =
      !urgent && pct >= MIN_DISCOUNT && (s.lastPct === undefined || p.current < s.lastPct);

    if (urgent || pctAlert) {
      const off = p.base && p.base > p.current ? ` (-${pct}%)` : "";
      const tag = p.free ? "🆓 FREE" : `💸 ${p.current}`;
      const lowNote = isNewLow ? "\n🔥 <b>Lowest price I've tracked</b>" : "";
      const head = urgent ? "" : `🏷 <b>${pct}% off</b> — above your target of ${item.target}\n`;
      const msg = `🎮 <b>${esc(item.name)}</b>\n${head}${tag}${off} — target: ${item.target}${lowNote}\n${item.url}`;
      if (urgent) await notify(msg);
      else await enqueue(msg);
      s.lastAlerted = p.current;
      s.lastPct = p.current;
    }
    // price went back up: re-arm so the next sale alerts again
    if (!belowTarget) delete s.lastAlerted;
    if (pct < MIN_DISCOUNT) delete s.lastPct;
  }

  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  writeMeta({ watchlistItems: items.length, pricesChecked: checked });
  await flushDigest();
}

if (require.main === module) checkWatchlist();
