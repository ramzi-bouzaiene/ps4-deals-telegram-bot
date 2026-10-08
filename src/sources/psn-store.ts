import { fetchWithRetry, sleep } from "../http";
import { gqlOp, PSN_HEADERS } from "../psn";
import { toNumber } from "../watchlist";
import type { DealSource, GameDeal } from "../types";
import type { RegionConfig } from "../regions";
import { PRODUCT_CLASSES } from "../product-classes";

// categoryGridRetrieve persisted query — promo category grid; tied to store
// web app 0.114.0, re-capture with scripts/capture-gql.js if it rotates.
const GRID_HASH = "88c0b9a1273c6d320c51cd73e390924e21ae28bf09f01cde8b84b1034b16cd03";
const PROMO_CATEGORY = "3f772501-f6f8-49b7-abac-874a88ca4897";
const PAGE_SIZE = 1000;
const MAX_PAGES = 5;
const MIN_PRICE = 0.99;
const MIN_PCT = 50;
const MIN_ORIGINAL = 5;

export const PSN_STORE_REGIONS = ["FR", "DE", "ES", "IT", "UK", "US"];

export function createPsnStoreSource(region: RegionConfig): DealSource {
  return {
    name: "psn-store",
    regions: PSN_STORE_REGIONS,
    fetchDeals: () => fetchDeals(region),
  };
}

function gridUrl(region: RegionConfig, offset: number): string {
  return gqlOp(
    "categoryGridRetrieve",
    {
      id: PROMO_CATEGORY,
      pageArgs: { size: PAGE_SIZE, offset },
      sortBy: null,
      filterBy: [],
      facetOptions: [],
    },
    GRID_HASH,
  );
}

async function fetchDeals(region: RegionConfig): Promise<GameDeal[]> {
  const headers = { ...PSN_HEADERS, "X-PSN-Store-Locale-Override": region.locale };
  const byTitle = new Map<string, GameDeal>();
  let offset = 0;
  let pages = 1;

  for (let p = 0; p < pages && p < MAX_PAGES; p++) {
    const res = await fetchWithRetry(gridUrl(region, offset), { headers });
    if (!res.ok) throw new Error(`categoryGridRetrieve HTTP ${res.status}`);
    const data = (await res.json()).data?.categoryGridRetrieve;
    if (!data) throw new Error("categoryGridRetrieve: no data in response");
    const total: number = data.pageInfo?.totalCount ?? 0;
    pages = Math.min(Math.ceil(total / PAGE_SIZE), MAX_PAGES);

    for (const g of data.products ?? []) {
      const cls = g.storeDisplayClassification;
      const clsFr = g.localizedStoreDisplayClassification;
      if (!PRODUCT_CLASSES.has(cls) && !PRODUCT_CLASSES.has(clsFr)) continue;
      const platforms: string[] = g.platforms ?? [];
      if (!platforms.includes("PS4")) continue;
      const price = g.price;
      if (!price || price.isFree) continue;
      const cur = toNumber(price.discountedPrice);
      const base = toNumber(price.basePrice);
      if (cur === null || base === null || cur < MIN_PRICE || base < MIN_ORIGINAL || cur >= base)
        continue;
      const pct = Math.round((1 - cur / base) * 100);
      if (pct < MIN_PCT) continue;

      const title = String(g.name ?? "").trim();
      const key = title.toLowerCase().replace(/[™®]/g, "").replace(/\s+/g, " ").trim();
      if (!key) continue;

      const cover = (g.media ?? []).find(
        (m: { role?: string; url?: string }) => m.role === "GAMEHUB_COVER_ART" && m.url,
      );
      const deal: GameDeal = {
        id: String(g.id),
        title,
        platform: "PS4",
        store: "PlayStation Store",
        region: region.code,
        currentPrice: cur,
        originalPrice: base,
        currency: region.currency,
        discountPercentage: pct,
        url: `https://store.playstation.com/${region.path}/product/${g.id}`,
        imageUrl: cover?.url,
      };
      const prev = byTitle.get(key);
      if (!prev || deal.currentPrice < prev.currentPrice) byTitle.set(key, deal);
    }

    offset += PAGE_SIZE;
    if (offset >= total) break;
    await sleep(600);
  }

  return [...byTitle.values()];
}
