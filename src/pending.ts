import path from "path";
import type { ProductSearchResult } from "./search";
import { readJsonFile, writeJsonFile, DATA_DIR } from "./util";

const PENDING_FILE = path.join(DATA_DIR, "pending-adds.json");
const MAX_ENTRIES = 30;

export interface PendingAdd extends ProductSearchResult {
  targetPrice?: number;
  expiresAt: number;
}

export function savePending(slot: string, entry: PendingAdd) {
  const all = readPending();
  all[slot] = entry;
  prune(all);
  writeJsonFile(PENDING_FILE, all);
}

export function readPending(): Record<string, PendingAdd> {
  const all = readJsonFile<Record<string, PendingAdd>>(PENDING_FILE, {});
  prune(all);
  return all;
}

export function takePending(slot: string): PendingAdd | undefined {
  const all = readPending();
  const entry = all[slot];
  if (!entry) return undefined;
  delete all[slot];
  writeJsonFile(PENDING_FILE, all);
  return entry;
}

function prune(all: Record<string, PendingAdd>) {
  const now = Date.now();
  for (const [k, v] of Object.entries(all)) {
    if (!v || typeof v.expiresAt !== "number" || v.expiresAt < now) delete all[k];
  }
  const keys = Object.keys(all);
  if (keys.length > MAX_ENTRIES) {
    for (const k of keys.slice(0, keys.length - MAX_ENTRIES)) delete all[k];
  }
}
