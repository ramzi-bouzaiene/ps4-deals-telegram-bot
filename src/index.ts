import Parser from "rss-parser";
import fs from "fs";
import { notify, enqueue, flushDigest, esc } from "./telegram";
import { loadPromosState, savePromosState, type PromoItem } from "./promos";
import { fetchWithRetry } from "./http";
import { gqlOp, PSN_HEADERS } from "./psn";

const parser = new Parser({
  timeout: 20000,
  headers: { "User-Agent": "Mozilla/5.0 (compatible; ps-deals-bot/1.0)" },
});

const SEEN_FILE = "seen.json";
const FREE_FILE = "docs/free.json";
const MONTHLY_FILE = "docs/monthly.json";
// SEED=1 npm run feeds  -> mark everything currently in the feeds as seen, send nothing
const SEED = process.env.SEED === "1";
const MAX_AGE_HOURS = 48;
const FREE_RX = /\bfree\b|gratuit(e|es)?|100\s*%\s*off/i;
// Official announcements only (blog.playstation.com) — reddit is too noisy.
export const MONTHLY_RX = /monthly games for|playstation plus monthly games|jeux mensuels/i;
export const PROMO_RX =
  /(sale|deals?|promotion|soldes?|% off|black friday|days of play|cyber monday|festival|big in japan)/i;

const DEFAULT_FEEDS = [
  "https://blog.playstation.com/feed/",
  "https://www.reddit.com/r/PlayStationPlus/new/.rss",
  "https://www.reddit.com/r/PS4Deals/new/.rss",
  "https://www.reddit.com/r/GameDeals/search.rss?q=PS4+OR+PSN&restrict_sr=1&sort=new",
];

const DEFAULT_KEYWORDS =
  "(ps plus|playstation plus|free|% off|sale|deal|discount|promotion|days of play|black friday)";

// Comma-separated URLs override the defaults entirely.
const FEEDS = process.env.FEEDS
  ? process.env.FEEDS.split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  : DEFAULT_FEEDS;

// Case-insensitive regex source; override with e.g. KEYWORDS="free|-%|deal"
const KEYWORDS = new RegExp(process.env.KEYWORDS ?? DEFAULT_KEYWORDS, "i");

const seen: string[] = fs.existsSync(SEEN_FILE)
  ? JSON.parse(fs.readFileSync(SEEN_FILE, "utf8"))
  : [];
const seenSet = new Set(seen);

type FreeEntry = { title: string; link: string; t: string };
type MonthlyEntry = {
  t: string;
  title: string;
  link: string;
  games: { name: string; url: string }[];
};

function readJsonArray<T>(file: string): T[] {
  try {
    const v = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

let freeList = readJsonArray<FreeEntry>(FREE_FILE);
let freeChanged = false;
let monthlyList = readJsonArray<MonthlyEntry>(MONTHLY_FILE);
let monthlyChanged = false;
const promos = loadPromosState();
let promosChanged = false;

const SEARCH_HASH = "4df6284f982e57bec70f23c77e2c219dc792eb19af7fb3d3a81767aa3f1958aa";

// "PlayStation Plus Monthly Games for August – Game A, Game B" → ["Game A", "Game B"]
export function monthlyNames(title: string): string[] {
  return title
    .replace(/.*monthly games for [^:–-]*[:–-]\s*/i, "")
    .split(/\s*,\s*/)
    .map((s) => s.replace(/\s*[™®].*$/, "").trim())
    .filter((s) => s.length > 1)
    .slice(0, 6);
}

// Fraction of the query's words the candidate name contains (normalized).
function nameScore(query: string, candidate: string): number {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[™®]/g, " ")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
  const q = norm(query);
  const c = new Set(norm(candidate));
  if (!q.length) return 0;
  return q.filter((t) => c.has(t)).length / q.length;
}

const PRODUCT_CLASSES = new Set([
  "FULL_GAME",
  "GAME_BUNDLE",
  "Jeu complet",
  "Offre de jeu groupée",
]);

// Blog posts don't link the store — resolve each game via store search instead.
export async function resolveMonthlyGames(title: string): Promise<{ name: string; url: string }[]> {
  const out: { name: string; url: string }[] = [];
  const seen = new Set<string>();
  for (const name of monthlyNames(title)) {
    try {
      const res = await fetchWithRetry(
        gqlOp(
          "getSearchResults",
          {
            countryCode: "FR",
            languageCode: "fr",
            nextCursor: "",
            pageOffset: 0,
            pageSize: 24,
            searchTerm: name,
          },
          SEARCH_HASH,
        ),
        { headers: PSN_HEADERS },
      );
      const json = (await res.json()) as { data?: { universalSearch?: { results?: unknown[] } } };
      const list = (json?.data?.universalSearch?.results ?? []) as Record<string, any>[];
      let best: Record<string, any> | null = null;
      let bestScore = 0;
      for (const r of list) {
        if (r.__typename !== "Product" || !r.price?.basePrice) continue;
        if (
          !PRODUCT_CLASSES.has(r.storeDisplayClassification) &&
          !PRODUCT_CLASSES.has(r.localizedStoreDisplayClassification)
        )
          continue;
        if (!(r.platforms ?? []).some((p: string) => p === "PS4" || p === "PS5")) continue;
        const score = nameScore(name, String(r.name ?? ""));
        if (score > bestScore) {
          bestScore = score;
          best = r;
        }
        if (score >= 0.99) break;
      }
      if (best && bestScore >= 0.6 && !seen.has(best.id)) {
        seen.add(best.id);
        out.push({
          name: String(best.name ?? name),
          url: `https://store.playstation.com/fr-fr/product/${best.id}`,
        });
      }
    } catch {
      // best effort — a missing link must not kill the notification
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return out;
}

async function main() {
  const cutoff = Date.now() - MAX_AGE_HOURS * 3600 * 1000;

  for (const url of FEEDS) {
    const isBlog = url.includes("blog.playstation.com");
    try {
      const feed = await parser.parseURL(url);
      for (const item of feed.items) {
        const id = item.guid ?? item.link;
        if (!id || seenSet.has(id)) continue;

        const title = item.title ?? "";
        if (!KEYWORDS.test(title)) continue;

        const ts = item.isoDate ? Date.parse(item.isoDate) : Date.now();
        if (!SEED && ts < cutoff) {
          seenSet.add(id);
          continue;
        }

        if (!SEED) {
          if (isBlog && MONTHLY_RX.test(title)) {
            // Monthly PS Plus lineup — urgent, with store links resolved via search.
            const link = item.link ?? "";
            const games = await resolveMonthlyGames(title);
            const gamesTxt = games.length
              ? "\n\n🛒 Store:\n" +
                games.map((g, i) => `${i + 1}. ${esc(g.name)} — ${g.url}`).join("\n")
              : "";
            await notify(
              `🗓 <b>PS Plus monthly games</b>\n🎮 <b>${esc(title)}</b>\n${link}${gamesTxt}`,
            );
            monthlyList.unshift({
              t: new Date(ts).toISOString(),
              title,
              link,
              games,
            });
            monthlyList = monthlyList.slice(0, 12);
            monthlyChanged = true;
          } else if (FREE_RX.test(title)) {
            // Free games are urgent: send now, never hold for the digest.
            await notify(`🆓 <b>Free game</b>\n🎮 <b>${esc(title)}</b>\n${item.link ?? ""}`);
            freeList.unshift({ title, link: item.link ?? "", t: new Date(ts).toISOString() });
            freeList = freeList.slice(0, 50);
            freeChanged = true;
          } else if (isBlog && PROMO_RX.test(title)) {
            // Official sale/promo announcements — urgent.
            await notify(
              `📣 <b>PS Store promotion</b>\n🎮 <b>${esc(title)}</b>\n${item.link ?? ""}`,
            );
            promos.items.unshift({
              t: new Date(ts).toISOString(),
              title,
              link: item.link ?? "",
              type: "rss" as PromoItem["type"],
            });
            promos.items = promos.items.slice(0, 50);
            promosChanged = true;
          } else {
            await enqueue(`🎮 <b>${esc(title)}</b>\n${item.link ?? ""}`);
          }
        }
        seenSet.add(id);
      }
    } catch (e) {
      console.error("Feed failed:", url, (e as Error).message);
    }
  }

  const list = [...seenSet];
  fs.writeFileSync(SEEN_FILE, JSON.stringify(list.slice(-500)));
  if (freeChanged) {
    fs.mkdirSync("docs", { recursive: true });
    fs.writeFileSync(FREE_FILE, JSON.stringify(freeList, null, 2) + "\n");
  }
  if (monthlyChanged) {
    fs.mkdirSync("docs", { recursive: true });
    fs.writeFileSync(MONTHLY_FILE, JSON.stringify(monthlyList, null, 2) + "\n");
  }
  if (promosChanged) savePromosState(promos);
  await flushDigest();
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
