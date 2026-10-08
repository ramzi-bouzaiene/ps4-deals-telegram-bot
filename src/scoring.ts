import type { GameDeal, ScoreWeights } from "./types";
import type { HistoryStats } from "./price-history";
import { clamp } from "./util";

export interface ScoreTier {
  key: "insane" | "hot" | "great" | "good" | "ignored";
  emoji: string;
  label: string;
}

export const TIERS: Record<ScoreTier["key"], ScoreTier> = {
  insane: { key: "insane", emoji: "🔥🔥", label: "INSANE DEAL" },
  hot: { key: "hot", emoji: "🔥", label: "HOT DEAL" },
  great: { key: "great", emoji: "⭐", label: "GREAT DEAL" },
  good: { key: "good", emoji: "👍", label: "GOOD DEAL" },
  ignored: { key: "ignored", emoji: "", label: "" },
};

export function tierFor(score: number): ScoreTier {
  if (score >= 90) return TIERS.insane;
  if (score >= 80) return TIERS.hot;
  if (score >= 70) return TIERS.great;
  if (score >= 60) return TIERS.good;
  return TIERS.ignored;
}

export interface ScoreFactors {
  discount: number | null;
  price: number | null;
  historical: number | null;
  drop: number | null;
  rating: number | null;
  popularity: number | null;
}

export interface ScoreResult {
  score: number;
  tier: ScoreTier;
  factors: ScoreFactors;
}

const PRICE_CEILING = 60;
const DROP_CEILING = 0.3;

export function calculateDealScore(
  deal: GameDeal,
  history: HistoryStats | undefined,
  weights: ScoreWeights,
): ScoreResult {
  const histLast = history?.latest;
  const factors: ScoreFactors = {
    discount: clamp(deal.discountPercentage / 100, 0, 1),
    price: clamp(1 - deal.currentPrice / PRICE_CEILING, 0, 1),
    historical: historicalFactor(deal, history),
    drop: dropFactor(deal, histLast),
    rating: deal.rating != null ? clamp(deal.rating / 10, 0, 1) : null,
    popularity: deal.popularity != null ? clamp(deal.popularity / 10, 0, 1) : null,
  };

  const entries = (Object.keys(weights) as (keyof ScoreWeights)[])
    .map((k) => ({ weight: weights[k], value: factors[k] }))
    .filter((e) => e.weight > 0 && e.value !== null);
  const totalWeight = entries.reduce((s, e) => s + e.weight, 0);
  const raw = entries.reduce((s, e) => s + e.weight * (e.value as number), 0);
  const score = totalWeight > 0 ? Math.round((raw / totalWeight) * 100) : 0;
  return { score: clamp(score, 0, 100), tier: tierFor(score), factors };
}

// At/under the historical low → 1; further above → 0.
function historicalFactor(deal: GameDeal, history: HistoryStats | undefined): number | null {
  if (!history || history.lowest === undefined || history.count < 1) return null;
  const low = history.lowest;
  if (deal.currentPrice <= low) return 1;
  return clamp(1 - (deal.currentPrice - low) / Math.max(low, 1), 0, 1);
}

// No drop (or price rose) → factor unknown, excluded rather than scored 0.
function dropFactor(deal: GameDeal, previousLast: number | undefined): number | null {
  if (previousLast === undefined || previousLast <= 0 || deal.currentPrice >= previousLast)
    return null;
  return clamp((previousLast - deal.currentPrice) / previousLast / DROP_CEILING, 0, 1);
}
