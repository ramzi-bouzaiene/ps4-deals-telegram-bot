import fs from "fs";
import path from "path";
import type { DealSource, GameDeal } from "../types";
import { getRegion, type RegionConfig } from "../regions";
import { readJsonFile, writeJsonFile, slugify, DATA_DIR } from "../util";
import { createPsnStoreSource } from "./psn-store";

export interface SourceRunResult {
  deals: GameDeal[];
  errors: { source: string; error: string }[];
}

export type SourceFactory = (region: RegionConfig) => DealSource;

const FACTORIES: SourceFactory[] = [createPsnStoreSource];

export async function fetchAllDeals(regionCode: string): Promise<SourceRunResult> {
  const region = getRegion(regionCode);
  const deals: GameDeal[] = [];
  const errors: { source: string; error: string }[] = [];

  for (const create of FACTORIES) {
    const source = create(region);
    if (!source.regions.includes(region.code)) {
      console.log(`Source ${source.name} does not support region ${region.code} — skipping`);
      continue;
    }
    try {
      const found = await source.fetchDeals();
      console.log(`Source ${source.name}: ${found.length} deals (${region.code})`);
      deals.push(...found);
    } catch (e) {
      const error = (e as Error).message;
      console.error(`Source ${source.name} failed: ${error}`);
      errors.push({ source: source.name, error });
    }
  }

  return { deals: dedupe(deals), errors };
}

function dedupe(deals: GameDeal[]): GameDeal[] {
  const byKey = new Map<string, GameDeal>();
  for (const d of deals) {
    const key = `${slugify(d.title)}:${d.region}`;
    const prev = byKey.get(key);
    if (!prev || d.currentPrice < prev.currentPrice) byKey.set(key, d);
  }
  return [...byKey.values()];
}

// --- shared cache: one fetch serves check-deals / daily / price-history / bot ---

interface DealsCache {
  fetchedAt: string;
  region: string;
  deals: GameDeal[];
}

const CACHE_FILE = path.join(DATA_DIR, "current-deals.json");
const DEFAULT_MAX_AGE_MS = 30 * 60 * 1000;

export function readDealsCache(): DealsCache | null {
  const raw = readJsonFile<DealsCache | null>(CACHE_FILE, null);
  if (!raw || !Array.isArray(raw.deals) || !raw.fetchedAt) return null;
  return raw;
}

export function writeDealsCache(region: string, deals: GameDeal[]) {
  writeJsonFile(CACHE_FILE, {
    fetchedAt: new Date().toISOString(),
    region,
    deals,
  });
}

/** Fresh cache → reuse (avoids duplicate API requests between workflows). */
export async function getDeals(opts: {
  region: string;
  maxAgeMs?: number;
  force?: boolean;
}): Promise<SourceRunResult & { fromCache: boolean }> {
  const maxAge = opts.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  if (!opts.force) {
    const cached = readDealsCache();
    if (
      cached &&
      cached.region === opts.region &&
      Date.now() - Date.parse(cached.fetchedAt) < maxAge
    ) {
      return { deals: cached.deals, errors: [], fromCache: true };
    }
  }
  const result = await fetchAllDeals(opts.region);
  if (result.deals.length) writeDealsCache(opts.region, result.deals);
  return { ...result, fromCache: false };
}

export function cacheAgeMs(): number | null {
  const cached = readDealsCache();
  if (!cached) return null;
  const age = Date.now() - Date.parse(cached.fetchedAt);
  return Number.isFinite(age) ? age : null;
}

export function cacheExists(): boolean {
  return fs.existsSync(CACHE_FILE);
}
