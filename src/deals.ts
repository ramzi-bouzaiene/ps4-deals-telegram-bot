import { notify, esc } from "./telegram";
import { fetchWithRetry, sleep } from "./http";
import { PSN_HEADERS, gqlOp } from "./psn";
import { toNumber } from "./watchlist";

// categoryGridRetrieve persisted query — "Toutes les promotions" category;
// tied to store web app 0.114.0, re-capture with scripts/capture-gql.js if it rotates.
const GRID_HASH = "88c0b9a1273c6d320c51cd73e390924e21ae28bf09f01cde8b84b1034b16cd03";
const PROMO_CATEGORY = "3f772501-f6f8-49b7-abac-874a88ca4897";
const PAGE_SIZE = 1000;
const MAX_PAGES = 5;
const MIN_PCT = 50;
const MIN_PRICE = 0.99;
const TOP = 30;

export type Deal = { name: string; cur: number; pct: number; url: string };

function gridUrl(offset: number): string {
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

export async function collectDeals(): Promise<Deal[]> {
  const byTitle = new Map<string, Deal>();
  let offset = 0;
  let pages = 1;

  for (let p = 0; p < pages && p < MAX_PAGES; p++) {
    const res = await fetchWithRetry(gridUrl(offset), { headers: PSN_HEADERS });
    if (!res.ok) throw new Error(`categoryGridRetrieve HTTP ${res.status}`);
    const data = (await res.json()).data?.categoryGridRetrieve;
    if (!data) throw new Error("categoryGridRetrieve: no data in response");
    const total: number = data.pageInfo?.totalCount ?? 0;
    pages = Math.min(Math.ceil(total / PAGE_SIZE), MAX_PAGES);

    for (const g of data.products ?? []) {
      if (g.storeDisplayClassification !== "FULL_GAME") continue;
      const platforms: string[] = g.platforms ?? [];
      if (!platforms.includes("PS4") && !platforms.includes("PS5")) continue;
      const price = g.price;
      if (!price || price.isFree) continue;
      const cur = toNumber(price.discountedPrice);
      const base = toNumber(price.basePrice);
      if (cur === null || base === null || cur < MIN_PRICE || base <= 0 || cur >= base) continue;
      const pct = Math.round((1 - cur / base) * 100);
      if (pct < MIN_PCT) continue;

      // PS4/PS5 SKUs of one game have different title ids — dedupe by name.
      const key = String(g.name ?? "")
        .toLowerCase()
        .replace(/[™®]/g, "")
        .replace(/\s+/g, " ")
        .trim();
      if (!key) continue;
      const deal: Deal = {
        name: String(g.name ?? "").trim() || "Unknown",
        cur,
        pct,
        url: `https://store.playstation.com/fr-fr/product/${g.id}`,
      };
      const prev = byTitle.get(key);
      if (!prev || deal.cur < prev.cur) byTitle.set(key, deal);
    }

    offset += PAGE_SIZE;
    if (offset >= total) break;
    await sleep(600);
  }

  return [...byTitle.values()].sort((a, b) => a.cur - b.cur || b.pct - a.pct).slice(0, TOP);
}

const fmt = (n: number) => `€${n.toFixed(2).replace(".", ",")}`;

export function buildMessage(deals: Deal[]): string {
  const date = new Date().toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const lines = deals.map(
    (d, i) => `${i + 1}. <b>${esc(d.name)}</b> — ${fmt(d.cur)} (-${d.pct}%) ${d.url}`,
  );
  return (
    `🏆 <b>Daily top ${TOP} — ${date}</b>\n<i>Full games ≥${MIN_PCT}% off · €${MIN_PRICE.toFixed(2).replace(".", ",")}– · cheapest first</i>\n\n` +
    lines.join("\n")
  );
}

async function main() {
  try {
    const deals = await collectDeals();
    if (!deals.length) {
      await notify(
        `⚠️ <b>Daily top ${TOP}</b> found no deals — the PS Store promo category may have changed. ` +
          `See README “If promotions stop updating”.`,
      );
      return;
    }
    console.log(
      `Sending daily top ${TOP}:`,
      deals
        .slice(0, 3)
        .map((d) => d.name)
        .join(", "),
      "...",
    );
    await notify(buildMessage(deals));
  } catch (e) {
    console.error(e);
    await notify(
      `⚠️ <b>Daily top ${TOP} failed</b>: ${esc((e as Error).message)}\n` +
        `The GraphQL hash may have rotated — see README “If promotions stop updating”.`,
    );
    process.exitCode = 1;
  }
}

if (require.main === module) main();
