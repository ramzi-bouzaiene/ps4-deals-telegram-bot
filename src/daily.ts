import type { InlineKeyboard, Preferences } from "./types";
import { loadPreferences } from "./preferences";
import { getRegion } from "./regions";
import { loadPriceHistory, historyStats } from "./price-history";
import { calculateDealScore } from "./scoring";
import { getDeals } from "./sources";
import { dailyDealsMessage } from "./format";
import { notify } from "./telegram";
import { slugify } from "./util";

export async function runDailyDeals(): Promise<number> {
  const prefs: Preferences = loadPreferences();
  const region = getRegion(prefs.region);
  const history = loadPriceHistory();
  const { deals, errors, fromCache } = await getDeals({
    region: prefs.region,
    maxAgeMs: 2 * 60 * 60 * 1000,
  });
  if (errors.length)
    console.error("Source errors:", errors.map((e) => `${e.source}: ${e.error}`).join("; "));

  const best = deals
    .map((deal) => ({
      deal,
      score: calculateDealScore(
        deal,
        historyStats(slugify(deal.title), history),
        prefs.scoreWeights,
      ),
    }))
    .filter((d) => d.score.score >= prefs.minimumDealScore)
    .sort((a, b) => b.score.score - a.score.score)
    .slice(0, prefs.dailyDealsCount);

  if (!best.length) {
    console.log(
      `daily-deals: no deals ≥ ${prefs.minimumDealScore} (from ${deals.length} fetched${fromCache ? ", cache" : ""})`,
    );
    return 0;
  }
  if (!prefs.notifications.dailyDeals) {
    console.log("daily-deals: disabled in config/preferences.json");
    return 0;
  }

  const keyboard: InlineKeyboard = {
    inline_keyboard: best.map((d, i) => [{ text: `${i + 1}. ${d.deal.title}`, url: d.deal.url }]),
  };
  console.log(
    `daily-deals: sending top ${best.length}:`,
    best.map((d) => `${d.deal.title} (${d.score.score})`).join(", "),
  );
  await notify(dailyDealsMessage(best, region), keyboard);
  return best.length;
}

if (require.main === module) {
  runDailyDeals().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
