import Parser from "rss-parser";
import fs from "fs";
import { notify, esc } from "./telegram";

const parser = new Parser({
  timeout: 20000,
  headers: { "User-Agent": "Mozilla/5.0 (compatible; ps-deals-bot/1.0)" },
});

const SEEN_FILE = "seen.json";
// SEED=1 npm run feeds  -> mark everything currently in the feeds as seen, send nothing
const SEED = process.env.SEED === "1";
const MAX_AGE_HOURS = 48;

const FEEDS = [
  "https://blog.playstation.com/feed/",
  "https://www.reddit.com/r/PlayStationPlus/new/.rss",
  "https://www.reddit.com/r/GameDeals/search.rss?q=PS4+OR+PSN&restrict_sr=1&sort=new",
];

const KEYWORDS = /(ps plus|playstation plus|free|% off|sale|deal|discount)/i;

const seen: string[] = fs.existsSync(SEEN_FILE)
  ? JSON.parse(fs.readFileSync(SEEN_FILE, "utf8"))
  : [];

(async () => {
  const cutoff = Date.now() - MAX_AGE_HOURS * 3600 * 1000;

  for (const url of FEEDS) {
    try {
      const feed = await parser.parseURL(url);
      for (const item of feed.items) {
        const id = item.guid ?? item.link;
        if (!id || seen.includes(id)) continue;

        const title = item.title ?? "";
        if (!KEYWORDS.test(title)) continue;

        const ts = item.isoDate ? Date.parse(item.isoDate) : Date.now();
        if (!SEED && ts < cutoff) {
          seen.push(id);
          continue;
        }

        if (!SEED) await notify(`🎮 <b>${esc(title)}</b>\n${item.link ?? ""}`);
        seen.push(id);
      }
    } catch (e) {
      console.error("Feed failed:", url, (e as Error).message);
    }
  }

  fs.writeFileSync(SEEN_FILE, JSON.stringify(seen.slice(-500)));
})();
