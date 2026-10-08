import fs from "fs";
import path from "path";
import type { GameDeal } from "./types";
import { slugify } from "./util";

const CATEGORIES_FILE = path.join("config", "categories.json");

export const CATEGORIES = [
  "action",
  "adventure",
  "rpg",
  "open world",
  "fps",
  "sports",
  "racing",
  "horror",
  "story",
  "multiplayer",
  "co-op",
] as const;

export type Category = (typeof CATEGORIES)[number];

let map: Record<string, string[]> | null = null;

export function loadCategoryMap(): Record<string, string[]> {
  if (map) return map;
  try {
    const raw = JSON.parse(fs.readFileSync(CATEGORIES_FILE, "utf8"));
    map = {};
    for (const [game, tags] of Object.entries<any>(raw)) {
      if (Array.isArray(tags))
        map[slugify(game)] = tags.map((t: unknown) => String(t).toLowerCase());
    }
  } catch {
    map = {};
  }
  return map;
}

export function categoriesFor(title: string): string[] {
  return loadCategoryMap()[slugify(title)] ?? [];
}

export function isValidCategory(query: string): boolean {
  const q = query.trim().toLowerCase();
  return (CATEGORIES as readonly string[]).some((c) => c === q || c.replace(/\s/g, "") === q);
}

export function filterByCategory(deals: GameDeal[], query: string): GameDeal[] {
  const q = query.trim().toLowerCase().replace(/\s/g, "");
  return deals.filter((d) =>
    categoriesFor(d.title).some((c) => c === q || c.replace(/\s/g, "") === q),
  );
}

export function categoryCounts(deals: GameDeal[]): { category: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const d of deals) {
    for (const c of categoriesFor(d.title)) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);
}
