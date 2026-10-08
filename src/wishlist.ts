import fs from "fs";
import path from "path";
import type { WishlistEntry } from "./types";
import { readJsonFile, writeJsonFile, slugify, DATA_DIR } from "./util";

export const WISHLIST_FILE = path.join(DATA_DIR, "wishlist.json");

export function loadWishlist(): WishlistEntry[] {
  if (fs.existsSync(WISHLIST_FILE)) {
    const raw = readJsonFile<unknown[]>(WISHLIST_FILE, []);
    return raw.filter(
      (e): e is WishlistEntry =>
        !!e && typeof e === "object" && typeof (e as WishlistEntry).title === "string",
    );
  }
  const migrated = migrateLegacyWatchlist();
  if (migrated.length) saveWishlist(migrated);
  return migrated;
}

export function saveWishlist(entries: WishlistEntry[]) {
  writeJsonFile(WISHLIST_FILE, entries);
}

// watchlist.json → data/wishlist.json on first run (then the old file goes away).
function migrateLegacyWatchlist(): WishlistEntry[] {
  const legacy = readJsonFile<{ name: string; url: string; target: number }[]>(
    "watchlist.json",
    [],
  );
  if (!legacy.length) return [];
  const entries = legacy.map((i) => ({
    gameId: slugify(i.name),
    title: i.name,
    targetPrice: i.target,
    url: i.url,
  }));
  try {
    fs.unlinkSync("watchlist.json");
    console.log(`Migrated ${entries.length} watchlist entries → ${WISHLIST_FILE}`);
  } catch {
    /* keep the file if it cannot be removed */
  }
  return entries;
}

export function addToWishlist(entry: WishlistEntry): { added: boolean; reason?: string } {
  const entries = loadWishlist();
  const key = entry.gameId || slugify(entry.title);
  if (entries.some((e) => e.gameId === key))
    return { added: false, reason: "Already on your wishlist." };
  entries.push({ ...entry, gameId: key });
  saveWishlist(entries);
  return { added: true };
}

export function removeFromWishlist(gameId: string): WishlistEntry | undefined {
  const entries = loadWishlist();
  const i = entries.findIndex((e) => e.gameId === gameId);
  if (i === -1) return undefined;
  const [removed] = entries.splice(i, 1);
  saveWishlist(entries);
  return removed;
}

export function setTargetPrice(gameId: string, targetPrice: number): WishlistEntry | undefined {
  const entries = loadWishlist();
  const e = entries.find((x) => x.gameId === gameId);
  if (!e) return undefined;
  e.targetPrice = targetPrice;
  saveWishlist(entries);
  return e;
}

export function findWishlistEntry(query: string): { entry?: WishlistEntry; index?: number } {
  const entries = loadWishlist();
  const q = slugify(query);
  let i = entries.findIndex((e) => e.gameId === q);
  if (i === -1) i = entries.findIndex((e) => e.gameId.includes(q) || q.includes(e.gameId));
  if (i === -1)
    i = entries.findIndex((e) => e.title.toLowerCase().includes(String(query).toLowerCase()));
  return i === -1 ? {} : { entry: entries[i], index: i };
}
