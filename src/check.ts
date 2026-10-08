import fs from "fs";
import path from "path";
import type { GameDeal, Preferences, PriceHistoryFile } from "./types";
import type { RegionConfig } from "./regions";
import { loadPreferences } from "./preferences";
import { getRegion } from "./regions";
import { loadPriceHistory, savePriceHistory, recordPrice, historyStats } from "./price-history";
import { loadWishlist } from "./wishlist";
import {
  loadNotifyState,
  saveNotifyState,
  shouldNotify,
  markSent,
  historyLowKey,
  wishlistKey,
  hotKey,
} from "./notify-state";
import { calculateDealScore, type ScoreResult } from "./scoring";
import { getDeals } from "./sources";
import { historicalLowMessage, wishlistAlertMessage, hotDealMessage, dealKeyboard } from "./format";
import { notify, flushDigest, esc } from "./telegram";
import { fetchPrice } from "./watchlist";
import { sleep } from "./http";
import { slugify } from "./util";

const MAX_HOT_PER_RUN = 5;
const SOURCE_DOWN_KEY = "system:source-down";

type LegacyEntry = {
  url?: string;
  history?: { t: string; price: number }[];
  low?: number;
  high?: number;
  lastBreak?: string;
};
type LegacyState = Record<string, LegacyEntry>;

function loadLegacy(): LegacyState {
  try {
    return JSON.parse(fs.readFileSync("docs/prices.json", "utf8"));
  } catch {
    return {};
  }
}

function saveLegacy(state: LegacyState) {
  fs.mkdirSync("docs", { recursive: true });
  fs.writeFileSync("docs/prices.json", JSON.stringify(state, null, 2));
}

function legacyRecord(state: LegacyState, name: string, url: string | undefined, price: number) {
  const entry = (state[name] ??= { history: [] });
  if (url) entry.url = url;
  entry.history ??= [];
  const last = entry.history.at(-1);
  if (!last || last.price !== price) entry.history.push({ t: new Date().toISOString(), price });
  entry.history = entry.history.slice(-500);
  if (entry.low === undefined || price < entry.low) entry.low = price;
  if (entry.high === undefined || price > entry.high) entry.high = price;
  delete entry.lastBreak;
}

async function alertBreak(state: LegacyState, name: string, url: string, reason: string) {
  const entry = (state[name] ??= { history: [] });
  const now = Date.now();
  const last = entry.lastBreak ? Date.parse(entry.lastBreak) : 0;
  if (now - last < 24 * 3600 * 1000) return;
  entry.lastBreak = new Date(now).toISOString();
  await notify(
    `⚠️ <b>Scraper broke</b> for ${esc(name)}\n${esc(reason)}\nRun \`npm run debug\` locally and adjust fetchPrice in src/watchlist.ts\n${url}`,
  );
}

function writeMeta(extra: Record<string, unknown> = {}) {
  fs.mkdirSync("docs", { recursive: true });
  let prev: Record<string, unknown> = {};
  try {
    prev = JSON.parse(fs.readFileSync("docs/meta.json", "utf8"));
  } catch {
    /* no meta yet */
  }
  fs.writeFileSync(
    "docs/meta.json",
    JSON.stringify({ ...prev, lastRun: new Date().toISOString(), ...extra }, null, 2),
  );
}

function productIdFromUrl(url: string): string {
  return url.split("/").pop()?.split("?")[0] ?? "";
}

// Dashboard snapshot: top scored deals + wishlist + aggregate stats for docs/deals.json.
function writeDealsSnapshot(
  scored: { deal: GameDeal; score: ScoreResult }[],
  wishlist: { title: string; url?: string; targetPrice: number; price?: number }[],
  prefs: Preferences,
  region: RegionConfig,
) {
  const sale = scored.filter((s) => s.deal.discountPercentage > 0);
  const best = scored.reduce<{ deal: GameDeal; score: ScoreResult } | undefined>(
    (acc, s) => (!acc || s.score.score > acc.score.score ? s : acc),
    undefined,
  );
  const countAt = (min: number) => scored.filter((s) => s.score.score >= min).length;
  const top = scored
    .filter((s) => s.score.score >= 60)
    .sort(
      (a, b) =>
        b.score.score - a.score.score ||
        b.deal.discountPercentage - a.deal.discountPercentage ||
        a.deal.currentPrice - b.deal.currentPrice,
    )
    .slice(0, 100)
    .map(({ deal, score }) => ({
      title: deal.title,
      url: deal.url,
      imageUrl: deal.imageUrl ?? null,
      currentPrice: deal.currentPrice,
      originalPrice: deal.originalPrice,
      discountPercentage: deal.discountPercentage,
      score: score.score,
      tier: score.tier.key,
    }));

  const snap = {
    generatedAt: new Date().toISOString(),
    region: prefs.region,
    currency: region.currency,
    symbol: region.symbol,
    minimumDealScore: prefs.minimumDealScore,
    stats: {
      total: scored.length,
      scored60: countAt(60),
      scored80: countAt(80),
      scored90: countAt(90),
      avgDiscount: sale.length
        ? Math.round(sale.reduce((n, s) => n + s.deal.discountPercentage, 0) / sale.length)
        : 0,
      maxScore: best?.score.score ?? 0,
      maxScoreTitle: best?.deal.title ?? "",
      wishlistCount: wishlist.length,
      wishlistHits: wishlist.filter((w) => w.price !== undefined && w.price <= w.targetPrice)
        .length,
    },
    deals: top,
    wishlist: wishlist.map((w) => ({
      title: w.title,
      url:
        w.url ??
        `https://store.playstation.com/${region.path}/search/${encodeURIComponent(w.title)}`,
      targetPrice: w.targetPrice,
      currentPrice: w.price ?? null,
      hit: w.price !== undefined && w.price <= w.targetPrice,
    })),
  };
  fs.mkdirSync("docs", { recursive: true });
  fs.writeFileSync("docs/deals.json", JSON.stringify(snap, null, 2) + "\n");
}

function dealForEntry(
  entry: { gameId: string; title: string; url?: string },
  price: number,
  original: number | null,
  region: RegionConfig,
): GameDeal {
  const base = original && original > price ? original : price;
  return {
    id: entry.url ? productIdFromUrl(entry.url) : entry.gameId,
    title: entry.title,
    platform: "PS4",
    store: "PlayStation Store",
    region: region.code,
    currentPrice: price,
    originalPrice: base,
    currency: region.currency,
    discountPercentage: base > price ? Math.round((1 - price / base) * 100) : 0,
    url:
      entry.url ??
      `https://store.playstation.com/${region.path}/search/${encodeURIComponent(entry.title)}`,
  };
}

async function sourceDownAlert(state: ReturnType<typeof loadNotifyState>, errorCount: number) {
  const now = new Date();
  const entry = state[SOURCE_DOWN_KEY];
  if (entry && now.getTime() - Date.parse(entry.sentAt) < 24 * 3600 * 1000) return;
  markSent(state, SOURCE_DOWN_KEY, 0, now);
  await notify(
    `⚠️ <b>All deal sources failed</b> (${errorCount} error${errorCount > 1 ? "s" : ""}) — no deals fetched this run. See README “If promotions stop updating”.`,
  );
}

export async function runCheck() {
  const prefs: Preferences = loadPreferences();
  const region = getRegion(prefs.region);
  const history: PriceHistoryFile = loadPriceHistory();
  const notifyState = loadNotifyState();
  const legacy = loadLegacy();
  const freshState = !fs.existsSync(
    path.join(process.env.DATA_DIR ?? "data", "notification-state.json"),
  );

  const { deals, errors } = await getDeals({ region: prefs.region, force: true });
  if (deals.length === 0 && errors.length > 0) await sourceDownAlert(notifyState, errors.length);

  const scored = deals.map((deal) => ({
    deal,
    score: calculateDealScore(deal, historyStats(slugify(deal.title), history), prefs.scoreWeights),
  }));

  const histLowEvents: { deal: GameDeal; score: ScoreResult }[] = [];
  for (const { deal, score } of scored) {
    const key = slugify(deal.title);
    const before = historyStats(key, history).lowest;
    const res = recordPrice(history, key, deal.currentPrice, deal.currency);
    if (
      before !== undefined &&
      res.previousLow !== undefined &&
      deal.currentPrice < res.previousLow
    )
      histLowEvents.push({ deal, score });
  }

  const dealBySlug = new Map(scored.map((s) => [slugify(s.deal.title), s]));
  const dealById = new Map(scored.map((s) => [s.deal.id, s]));
  const wishlistEvents: {
    deal: GameDeal;
    target: number;
    price: number;
    discount?: number;
  }[] = [];
  const wishSnapshot: { title: string; url?: string; targetPrice: number; price?: number }[] = [];

  for (const entry of loadWishlist()) {
    const key = entry.gameId || slugify(entry.title);
    const matched =
      dealBySlug.get(key) ?? (entry.url ? dealById.get(productIdFromUrl(entry.url)) : undefined);

    let price: number | undefined;
    let deal: GameDeal | undefined = matched?.deal;

    if (matched) {
      price = matched.deal.currentPrice;
    } else if (entry.url) {
      const r = await fetchPrice(entry.url);
      await sleep(3000);
      if (!r.ok) {
        if (r.broke) await alertBreak(legacy, entry.title, entry.url, r.reason);
        else console.error("Fetch failed:", entry.title, r.reason);
        wishSnapshot.push({
          title: entry.title,
          url: entry.url,
          targetPrice: entry.targetPrice,
        });
        continue;
      }
      price = r.price.current ?? undefined;
      if (price !== undefined) {
        const before = historyStats(key, history).lowest;
        const res = recordPrice(history, key, price, region.currency);
        deal = dealForEntry(entry, price, r.price.base, region);
        if (before !== undefined && res.previousLow !== undefined && price < res.previousLow)
          histLowEvents.push({
            deal,
            score: calculateDealScore(deal, historyStats(key, history), prefs.scoreWeights),
          });
      }
    }

    if (price === undefined) {
      wishSnapshot.push({ title: entry.title, url: entry.url, targetPrice: entry.targetPrice });
      continue;
    }
    wishSnapshot.push({
      title: entry.title,
      url: entry.url,
      targetPrice: entry.targetPrice,
      price,
    });
    legacyRecord(legacy, entry.title, entry.url, price);

    if (prefs.notifications.wishlist && price <= entry.targetPrice && deal) {
      const discount =
        deal.originalPrice > price ? Math.round((1 - price / deal.originalPrice) * 100) : undefined;
      wishlistEvents.push({ deal, target: entry.targetPrice, price, discount });
    }
  }

  const hotCandidates = scored
    .filter((s) => s.score.score >= prefs.minimumDealScore)
    .sort((a, b) => b.score.score - a.score.score);
  if (freshState) {
    // First run: remember current conditions without bursting notifications.
    for (const ev of histLowEvents)
      markSent(notifyState, historyLowKey(ev.deal.title), ev.deal.currentPrice);
    for (const ev of wishlistEvents) markSent(notifyState, wishlistKey(ev.deal.title), ev.price);
    for (const ev of hotCandidates)
      markSent(notifyState, hotKey(ev.deal.title), ev.deal.currentPrice);
  }
  const histToSend = freshState ? [] : histLowEvents;
  const wishToSend = freshState ? [] : wishlistEvents;
  const hotEvents = freshState ? [] : hotCandidates.slice(0, MAX_HOT_PER_RUN);

  let hotSent = 0;
  let histSent = 0;
  let wishSent = 0;

  for (const ev of histToSend) {
    const key = historyLowKey(ev.deal.title);
    if (!shouldNotify(notifyState, key, ev.deal.currentPrice)) continue;
    markSent(notifyState, key, ev.deal.currentPrice);
    await notify(historicalLowMessage(ev.deal, ev.score, region, prefs), dealKeyboard(ev.deal));
    histSent++;
  }

  for (const ev of wishToSend) {
    const key = wishlistKey(ev.deal.title);
    if (!shouldNotify(notifyState, key, ev.price)) continue;
    markSent(notifyState, key, ev.price);
    await notify(
      wishlistAlertMessage(
        { title: ev.deal.title, price: ev.price, targetPrice: ev.target, discount: ev.discount },
        region,
        prefs,
      ),
      dealKeyboard(ev.deal),
    );
    wishSent++;
  }

  for (const ev of hotEvents) {
    const key = hotKey(ev.deal.title);
    if (!shouldNotify(notifyState, key, ev.deal.currentPrice)) continue;
    markSent(notifyState, key, ev.deal.currentPrice);
    await notify(hotDealMessage(ev.deal, ev.score, region, prefs), dealKeyboard(ev.deal));
    hotSent++;
    if (hotSent >= MAX_HOT_PER_RUN) break;
  }

  savePriceHistory(history);
  saveNotifyState(notifyState);
  saveLegacy(legacy);
  writeMeta({
    dealsChecked: deals.length,
    sourceErrors: errors.length,
    alertsSent: histSent + wishSent + hotSent,
    region: prefs.region,
    watchlistItems: wishSnapshot.length,
    pricesChecked: Object.values(legacy).filter((e) => (e.history ?? []).length > 0).length,
  });
  writeDealsSnapshot(scored, wishSnapshot, prefs, region);
  await flushDigest();

  console.log(
    `check-deals: ${deals.length} deals, ${errors.length} source error(s), ` +
      `alerts hist-low=${histSent} wishlist=${wishSent} hot=${hotSent}` +
      (hotEvents.length === 0 && !freshState ? " (no deals ≥ minimum score)" : ""),
  );
  if (freshState && scored.length)
    console.log("First run: seeded notification state silently (no hot-deal burst).");
}

if (require.main === module) {
  runCheck().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
