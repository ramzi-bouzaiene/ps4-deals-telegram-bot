import fs from "fs";
import { notify, esc } from "./telegram";

type Item = { name: string; url: string; target: number };
type Price = { current: number | null; base: number | null; free: boolean };
type State = Record<
  string,
  { lastAlerted?: number; low?: number; history: { t: string; price: number }[] }
>;

const STATE_FILE = "docs/prices.json";
const DEBUG = process.env.DEBUG === "1";

const state: State = fs.existsSync(STATE_FILE)
  ? JSON.parse(fs.readFileSync(STATE_FILE, "utf8"))
  : {};

const toNumber = (s: unknown): number | null => {
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

async function fetchPrice(url: string): Promise<Price | null> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; ps-deals-bot/1.0)",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  if (!res.ok) {
    console.error("HTTP", res.status, url);
    return null;
  }
  const html = await res.text();
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) {
    console.error("No __NEXT_DATA__ found, page structure may have changed:", url);
    return null;
  }
  const blocks = collectPrices(JSON.parse(m[1]));
  if (DEBUG) console.log(JSON.stringify(blocks.slice(0, 5), null, 2));

  // Lowest non-null price across blocks (covers editions/bundles).
  const current = blocks
    .map((b) => (b.isFree ? 0 : toNumber(b.discountedPrice) ?? toNumber(b.basePrice)))
    .filter((v): v is number => v !== null);
  const base = blocks.map((b) => toNumber(b.basePrice)).filter((v): v is number => v !== null);
  if (!current.length) return null;
  return {
    current: Math.min(...current),
    base: base.length ? Math.max(...base) : null,
    free: current.includes(0),
  };
}

export async function checkWatchlist() {
  fs.mkdirSync("docs", { recursive: true });
  const items: Item[] = JSON.parse(fs.readFileSync("watchlist.json", "utf8"));

  for (const item of items) {
    const p = await fetchPrice(item.url);
    await new Promise((r) => setTimeout(r, 3000)); // be polite
    if (!p || p.current === null) continue;

    const s = (state[item.name] ??= { history: [] });
    const last = s.history.at(-1);
    if (!last || last.price !== p.current)
      s.history.push({ t: new Date().toISOString(), price: p.current });
    s.history = s.history.slice(-500);

    const previousLow = s.low;
    const isNewLow = previousLow !== undefined && p.current < previousLow;
    if (previousLow === undefined || p.current < previousLow) s.low = p.current;

    const belowTarget = p.current <= item.target;
    const newLowAlert = s.lastAlerted === undefined || p.current < s.lastAlerted;

    if ((belowTarget && newLowAlert) || isNewLow) {
      const off =
        p.base && p.base > p.current ? ` (-${Math.round((1 - p.current / p.base) * 100)}%)` : "";
      const tag = p.free ? "🆓 FREE" : `💸 ${p.current}`;
      const lowNote = isNewLow ? "\n🔥 <b>Lowest price I've tracked</b>" : "";
      await notify(
        `🎮 <b>${esc(item.name)}</b>\n${tag}${off} — target: ${item.target}${lowNote}\n${item.url}`
      );
      s.lastAlerted = p.current;
    }
    // price went back up: re-arm so the next sale alerts again
    if (!belowTarget) delete s.lastAlerted;
  }

  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

if (require.main === module) checkWatchlist();
