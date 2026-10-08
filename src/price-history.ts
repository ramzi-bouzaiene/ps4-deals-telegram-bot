import fs from "fs";
import path from "path";
import type { PriceHistoryFile, PricePoint, PriceHistoryEntry } from "./types";
import { readJsonFile, writeJsonFile, slugify, todayISO, DATA_DIR } from "./util";
import { loadPreferences } from "./preferences";
import { getRegion } from "./regions";
import { getDeals } from "./sources";

export { DATA_DIR };
export const PRICE_HISTORY_FILE = path.join(DATA_DIR, "price-history.json");

let cache: PriceHistoryFile | null = null;

export function loadPriceHistory(): PriceHistoryFile {
  if (cache) return cache;
  let file = readJsonFile<PriceHistoryFile>(PRICE_HISTORY_FILE, {});
  if (!Object.keys(file).length) file = seedFromLegacy();
  cache = file;
  return file;
}

// First run: carry the dashboard's per-game history over to data/price-history.json.
function seedFromLegacy(): PriceHistoryFile {
  const legacy = readJsonFile<Record<string, { history?: { t: string; price: number }[] }>>(
    "docs/prices.json",
    {},
  );
  const out: PriceHistoryFile = {};
  for (const [name, state] of Object.entries(legacy)) {
    const prices: PricePoint[] = (state.history ?? []).map((p) => ({
      price: p.price,
      currency: "EUR",
      date: String(p.t).slice(0, 10),
    }));
    if (prices.length) out[slugify(name)] = { prices };
  }
  return out;
}

export function savePriceHistory(history: PriceHistoryFile) {
  writeJsonFile(PRICE_HISTORY_FILE, history);
}

/** One point per day per game: same day updates the price, new day appends. */
export function recordPrice(
  history: PriceHistoryFile,
  key: string,
  price: number,
  currency: string,
  date = todayISO(),
): { previousLow: number | undefined; previousLast: number | undefined; isNewLow: boolean } {
  const entry: PriceHistoryEntry = history[key] ?? (history[key] = { prices: [] });
  const last = entry.prices.at(-1);
  const previousLow = entry.prices.length
    ? Math.min(...entry.prices.map((p) => p.price))
    : undefined;
  const previousLast = last?.price;

  if (last && last.date === date) {
    last.price = price;
    last.currency = currency;
  } else if (!last || last.price !== price) {
    entry.prices.push({ price, currency, date });
    if (entry.prices.length > 365) entry.prices.splice(0, entry.prices.length - 365);
  }

  const isNewLow = previousLow === undefined ? entry.prices.length === 1 : price < previousLow;
  return { previousLow, previousLast, isNewLow };
}

export interface HistoryStats {
  lowest: number | undefined;
  latest: number | undefined;
  previous: number | undefined;
  count: number;
  nearLow: boolean;
  points: PricePoint[];
}

export function historyStats(key: string, history = loadPriceHistory()): HistoryStats {
  const points = history[key]?.prices ?? [];
  const lowest = points.length ? Math.min(...points.map((p) => p.price)) : undefined;
  const latest = points.at(-1)?.price;
  const previous = points.length > 1 ? points[points.length - 2].price : undefined;
  const nearLow = lowest !== undefined && latest !== undefined && latest <= lowest * 1.1;
  return { lowest, latest, previous, count: points.length, nearLow, points };
}

export function findHistoryKey(query: string, history = loadPriceHistory()): string | undefined {
  const q = slugify(query);
  if (history[q]) return q;
  return Object.keys(history).find((k) => k.includes(q) || q.includes(k));
}

export function historyExists(file = PRICE_HISTORY_FILE): boolean {
  return fs.existsSync(file);
}

// CLI: refresh recorded prices without sending notifications
// (npm run price-history — used by price-history.yml).
async function updateHistoryOnly() {
  const prefs = loadPreferences();
  const region = getRegion(prefs.region);
  const history = loadPriceHistory();
  const { deals, errors } = await getDeals({
    region: prefs.region,
    maxAgeMs: 6 * 60 * 60 * 1000,
  });
  if (errors.length)
    console.error("Source errors:", errors.map((e) => `${e.source}: ${e.error}`).join("; "));
  if (!deals.length) {
    console.error("price-history: no deals fetched");
    process.exitCode = 1;
    return;
  }
  let updated = 0;
  for (const deal of deals) {
    const before = historyStats(slugify(deal.title), history).count;
    recordPrice(history, slugify(deal.title), deal.currentPrice, deal.currency);
    if (historyStats(slugify(deal.title), history).count !== before) updated++;
  }
  savePriceHistory(history);
  console.log(
    `price-history: ${deals.length} deals processed, ${updated} new point(s), region ${region.code}`,
  );
}

if (require.main === module) {
  updateHistoryOnly().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
