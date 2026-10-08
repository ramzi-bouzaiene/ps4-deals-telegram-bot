import fs from "fs";
import path from "path";
import type { Preferences } from "./types";
import { getRegion, SUPPORTED_REGIONS } from "./regions";

const CONFIG_FILE = path.join("config", "preferences.json");

export const DEFAULT_PREFERENCES: Preferences = {
  region: "FR",
  currency: "EUR",
  displayTND: false,
  tndRate: 3.35,
  minimumDealScore: 80,
  dailyDealsCount: 5,
  notifications: {
    historicalLow: true,
    wishlist: true,
    hotDeals: true,
    dailyDeals: true,
  },
  scoreWeights: {
    discount: 30,
    price: 20,
    historical: 25,
    drop: 15,
    rating: 10,
    popularity: 0,
  },
};

export function loadPreferences(): Preferences {
  let stored: Partial<Preferences> = {};
  try {
    stored = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  } catch {
    /* first run / missing file → defaults */
  }
  const prefs: Preferences = {
    ...DEFAULT_PREFERENCES,
    ...stored,
    notifications: { ...DEFAULT_PREFERENCES.notifications, ...stored.notifications },
    scoreWeights: { ...DEFAULT_PREFERENCES.scoreWeights, ...stored.scoreWeights },
  };
  const envRegion = process.env.DEFAULT_REGION;
  if (envRegion) prefs.region = envRegion.toUpperCase();
  if (!SUPPORTED_REGIONS.includes(prefs.region.toUpperCase()))
    throw new Error(
      `Invalid region "${prefs.region}" — use one of: ${SUPPORTED_REGIONS.join(", ")}`,
    );
  prefs.region = prefs.region.toUpperCase();
  getRegion(prefs.region);
  if (!Number.isFinite(prefs.minimumDealScore) || prefs.minimumDealScore < 0)
    prefs.minimumDealScore = DEFAULT_PREFERENCES.minimumDealScore;
  if (!Number.isFinite(prefs.dailyDealsCount) || prefs.dailyDealsCount < 1)
    prefs.dailyDealsCount = DEFAULT_PREFERENCES.dailyDealsCount;
  return prefs;
}

export function savePreferences(prefs: Preferences) {
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(prefs, null, 2) + "\n");
}
