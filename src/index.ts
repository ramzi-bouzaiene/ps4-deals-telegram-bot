import Parser from "rss-parser";
import fs from "fs";
import { notify, enqueue, flushDigest, esc } from "./telegram";

const parser = new Parser({
  timeout: 20000,
  headers: { "User-Agent": "Mozilla/5.0 (compatible; ps-deals-bot/1.0)" },
});

const SEEN_FILE = "seen.json";
const FREE_FILE = "docs/free.json";
// SEED=1 npm run feeds  -> mark everything currently in the feeds as seen, send nothing
const SEED = process.env.SEED === "1";
const MAX_AGE_HOURS = 48;
const FREE_RX = /\bfree\b|gratuit(e|es)?|100\s*%\s*off/i;

const DEFAULT_FEEDS = [
  "https://blog.playstation.com/feed/",
  "https://www.reddit.com/r/PlayStationPlus/new/.rss",
  "https://www.reddit.com/r/PS4Deals/new/.rss",
  "https://www.reddit.com/r/GameDeals/search.rss?q=PS4+OR+PSN&restrict_sr=1&sort=new",
];

const DEFAULT_KEYWORDS = "(ps plus|playstation plus|free|% off|sale|deal|discount)";

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
let freeList: FreeEntry[] = [];
try {
  const v = JSON.parse(fs.readFileSync(FREE_FILE, "utf8"));
  if (Array.isArray(v)) freeList = v;
} catch {
  /* no free.json yet */
}
let freeChanged = false;

(async () => {
  const cutoff = Date.now() - MAX_AGE_HOURS * 3600 * 1000;

  for (const url of FEEDS) {
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
          const msg = `🎮 <b>${esc(title)}</b>\n${item.link ?? ""}`;
          if (FREE_RX.test(title)) {
            // Free games are urgent: send now, never hold for the digest.
            await notify(`🆓 <b>Free game</b>\n${msg}`);
            freeList.unshift({ title, link: item.link ?? "", t: new Date(ts).toISOString() });
            freeList = freeList.slice(0, 50);
            freeChanged = true;
          } else {
            await enqueue(msg);
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
  await flushDigest();
})();
