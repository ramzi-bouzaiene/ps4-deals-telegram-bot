import path from "path";
import type { PriceHistoryFile } from "./types";
import { readJsonFile, writeJsonFile, slugify, DATA_DIR } from "./util";
import { loadPriceHistory } from "./price-history";
import { loadWishlist } from "./wishlist";

export const NOTIFY_STATE_FILE = path.join(DATA_DIR, "notification-state.json");

export interface NotifyEntry {
  lastPrice: number;
  sentAt: string;
}

export type NotifyState = Record<string, NotifyEntry>;

export function loadNotifyState(): NotifyState {
  return readJsonFile<NotifyState>(NOTIFY_STATE_FILE, {});
}

export function saveNotifyState(state: NotifyState) {
  writeJsonFile(NOTIFY_STATE_FILE, state);
}

/**
 * Anti-spam gate: notify only when the price dropped below the last notified
 * price, or after a sale ends (price back up ≥10% → re-arm silently so the
 * next drop alerts again).
 */
export function shouldNotify(
  state: NotifyState,
  key: string,
  price: number,
  now = new Date(),
): boolean {
  const entry = state[key];
  if (!entry) return true;
  if (price > entry.lastPrice * 1.1) {
    entry.lastPrice = price;
    entry.sentAt = now.toISOString();
    return false;
  }
  return price < entry.lastPrice;
}

export function markSent(state: NotifyState, key: string, price: number, now = new Date()) {
  state[key] = { lastPrice: price, sentAt: now.toISOString() };
}

export function historyLowKey(title: string): string {
  return `${slugify(title)}:historical-low`;
}

export function wishlistKey(title: string): string {
  return `${slugify(title)}:wishlist`;
}

export function hotKey(title: string): string {
  return `${slugify(title)}:hot`;
}

export interface TrackedGame {
  slug: string;
  title: string;
  price: number;
  currency: string;
  targetPrice?: number;
  url?: string;
}

/**
 * Build the alert set for this run: wishlist targets + historical lows from
 * the current price history (both wishlist and deal games).
 */
export function collectAlertCandidates(
  history: PriceHistoryFile = loadPriceHistory(),
): TrackedGame[] {
  const seen = new Set<string>();
  const out: TrackedGame[] = [];
  for (const e of loadWishlist()) {
    const key = e.gameId || slugify(e.title);
    if (seen.has(key)) continue;
    const points = history[key]?.prices ?? [];
    const price = points.at(-1)?.price;
    if (price === undefined) continue;
    seen.add(key);
    out.push({
      slug: key,
      title: e.title,
      price,
      currency: points.at(-1)?.currency ?? "EUR",
      targetPrice: e.targetPrice,
      url: e.url,
    });
  }
  return out;
}
