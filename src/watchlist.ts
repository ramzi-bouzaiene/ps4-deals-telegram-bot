import { fetchWithRetry } from "./http";

export type Price = { current: number | null; base: number | null; free: boolean };
export type FetchResult =
  { ok: true; price: Price } | { ok: false; reason: string; broke: boolean };

const DEBUG = process.env.DEBUG === "1";

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
