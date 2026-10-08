import { fetchWithRetry } from "./http";
import { gqlOp, PSN_HEADERS } from "./psn";
import { getRegion } from "./regions";
import { toNumber } from "./watchlist";
import { PRODUCT_CLASSES } from "./product-classes";

// getSearchResults persisted query — tied to store web app 0.114.0.
const SEARCH_HASH = "4df6284f982e57bec70f23c77e2c219dc792eb19af7fb3d3a81767aa3f1958aa";

export interface ProductSearchResult {
  id: string;
  title: string;
  url: string;
  currentPrice: number;
  originalPrice: number;
  discountPercentage: number;
  free: boolean;
  imageUrl?: string;
}

export async function searchProducts(
  query: string,
  regionCode: string,
  limit = 5,
): Promise<ProductSearchResult[]> {
  const region = getRegion(regionCode);
  const url = gqlOp(
    "getSearchResults",
    {
      countryCode: region.country,
      languageCode: region.language,
      nextCursor: "",
      pageOffset: 0,
      pageSize: Math.max(limit * 3, 15),
      searchTerm: query,
    },
    SEARCH_HASH,
  );
  const res = await fetchWithRetry(url, {
    headers: { ...PSN_HEADERS, "X-PSN-Store-Locale-Override": region.locale },
  });
  if (!res.ok) throw new Error(`getSearchResults HTTP ${res.status}`);
  const json = (await res.json()) as { data?: { universalSearch?: { results?: unknown[] } } };
  const raw = json?.data?.universalSearch?.results;
  if (!Array.isArray(raw)) return [];

  const out: ProductSearchResult[] = [];
  for (const n of raw as Record<string, any>[]) {
    if (n.__typename !== "Product") continue;
    const platforms: string[] = n.platforms ?? [];
    if (!platforms.includes("PS4")) continue;
    if (
      !PRODUCT_CLASSES.has(n.storeDisplayClassification) &&
      !PRODUCT_CLASSES.has(n.localizedStoreDisplayClassification)
    )
      continue;
    const price = n.price;
    if (!price) continue;

    const free = price.isFree === true;
    const cur = free ? 0 : (toNumber(price.discountedPrice) ?? toNumber(price.basePrice));
    const base = free ? 0 : (toNumber(price.basePrice) ?? cur);
    if (cur === null || base === null) continue;

    const cover = (n.media ?? []).find(
      (m: { role?: string; url?: string }) => m.role === "GAMEHUB_COVER_ART" && m.url,
    );
    out.push({
      id: String(n.id),
      title: String(n.name ?? query),
      url: `https://store.playstation.com/${region.path}/product/${n.id}`,
      currentPrice: cur,
      originalPrice: base,
      discountPercentage: base > cur ? Math.round((1 - cur / base) * 100) : 0,
      free,
      imageUrl: cover?.url,
    });
    if (out.length >= limit) break;
  }
  return out;
}

/** First result whose name contains most of the query's words. */
export function pickBestMatch(
  query: string,
  results: ProductSearchResult[],
): ProductSearchResult | undefined {
  if (!results.length) return undefined;
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 1);
  let best = results[0];
  let bestScore = -1;
  for (const r of results) {
    const title = r.title.toLowerCase();
    const score = words.filter((w) => title.includes(w)).length;
    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }
  return best;
}
