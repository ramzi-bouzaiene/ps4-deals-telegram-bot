# PS4 Deals Bot

Sends Telegram alerts for PS Plus / free games / deals (RSS feeds) and for price drops on a personal watchlist (PS Store pages). Runs free on GitHub Actions every 2 hours. A small dashboard in `docs/` can be hosted with GitHub Pages — it lists currently free games (`Free right now`), tracked prices, and recent news.

## What it sends

| Alert                          | When                                                                                                                                                           |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 📣 **New PS Store promotions** | when a new promo banner/campaign appears on the store (homepage + deals landing, checked every 2h) and for official sale announcements on the PlayStation Blog |
| 🏆 **Daily top 30 deals**      | every day at 09:00 France time: full games ≥50% off and €1+, cheapest first                                                                                    |
| 🗓 **Monthly PS Plus games**    | when Sony announces the monthly PS Plus lineup, with store links to the games                                                                                  |
| 🆓 **Free games**              | free-to-play releases and “free” titles in the RSS feeds, immediately                                                                                          |
| 💸 **Watchlist price alerts**  | when a tracked game hits your target / a new low / a big % discount                                                                                            |

## Setup

1. **Telegram bot**: message @BotFather, send `/newbot`, copy the token. Send any message to your new bot, then open
   `https://api.telegram.org/bot<TOKEN>/getUpdates` and copy `chat.id`.
2. **Repo**: create a GitHub repo and push this folder.
3. **Secrets**: Settings → Secrets and variables → Actions → add `TG_TOKEN` and `TG_CHAT_ID`.
4. **Watchlist**: `watchlist.json` ships with real French PS Store pages — cheap games with targets below €10 plus free-to-play titles at target `0`. Edit it or add games with the bot: `/watch <url> <target>`.
5. **Avoid the first-run flood**: run `SEED=1 npm run feeds` locally once and commit `seen.json`.
6. **Run**: Actions tab → "PS4 deals" → Run workflow to test.
7. **Dashboard (optional)**: Settings → Pages → Deploy from a branch → `main` / `/docs`.

## Chat commands

The "PS4 deals bot (commands)" workflow long-polls Telegram every 5 minutes, so you can manage the watchlist from chat (only `TG_CHAT_ID` is authorized):

```
/watch <url> <target> [name]   track a PS Store price (alerts at ≤ target)
/list                          everything you track, with last known price
/price <n|name>                fetch the current price right now
/remove <n|name>               stop tracking
/help
```

Watchlist edits made in chat are committed back to `watchlist.json` automatically.
Private repos: change the bot cron to `*/15` and `BOT_POLL_SECONDS` to `860` to save Actions minutes.

## Optional settings

Non-secret options go to **Settings → Secrets and variables → Actions → Variables**:

| Variable       | Default     | Effect                                                                            |
| -------------- | ----------- | --------------------------------------------------------------------------------- |
| `MIN_DISCOUNT` | `50`        | also alert on any discount ≥ this %, even above your target                       |
| `DIGEST`       | off         | `1` = queue non-urgent alerts during quiet hours, send one combined message after |
| `QUIET_HOURS`  | `22-8`      | hours (UTC, GitHub's clock) when `DIGEST` holds messages back                     |
| `FEEDS`        | built-ins   | comma-separated RSS URLs, replaces the default feed list                          |
| `KEYWORDS`     | PS keywords | case-insensitive regex that titles must match                                     |

Secrets (optional, can be combined with Telegram):

| Secret                     | Effect                                  |
| -------------------------- | --------------------------------------- |
| `DISCORD_WEBHOOK`          | also post to a Discord channel          |
| `NTFY_URL` or `NTFY_TOPIC` | also post via ntfy.sh                   |
| `WEBHOOK_URL`              | POST `{ text, content }` to any webhook |

Urgent alerts (target hit, new low, free game, scraper breakage — including free-game RSS titles) always go out immediately; other RSS news and ≥`MIN_DISCOUNT` deals are digest-eligible. Free-game titles are also collected into `docs/free.json` for the dashboard.

## Local testing

```bash
npm install
cp .env.example .env   # fill in values (scripts load it automatically)
npm run feeds          # RSS check (free games, monthly PS Plus, promos)
npm run promos         # check the store for new promotion banners
npm run deals          # build the daily top-30 message now
npm run debug          # watchlist check, prints the price blocks it found
npm run bot            # poll Telegram for commands (BOT_POLL_SECONDS to bound it)
npm run check          # TypeScript type check
npm run lint           # ESLint
npm run format:check   # Prettier
```

Without a notification channel configured, messages are printed to the console instead of sent.

## If promotions stop updating

The promo/top-30 features replay Sony's internal GraphQL endpoint with fixed hashes (tied to the store web app version). If Sony rotates them you'll get a ⚠️ alert. To re-capture: `npm i playwright --no-save && npx playwright install chromium && node scripts/capture-gql.js`, then paste the printed hash/URL into `src/promos.ts` / `src/deals.ts`.

## If prices don't show up

PlayStation has no public API. The scraper reads the JSON embedded in store pages (`__NEXT_DATA__`, including the `<script type="application/json">` blobs inside `batarangs.*.text`) and picks the cheapest standard purchase price, ignoring PS Plus "Inclus" subscription upsells. If Sony changes the markup, the bot pings you with a ⚠️ breakage alert (once per game per day) — run `npm run debug` and adjust `fetchPrice` in `src/watchlist.ts`. If GitHub's IPs get blocked, run the same job from a home machine or small VPS with cron.

## Files

- `src/index.ts`: RSS feeds → Telegram (dedupe via `seen.json`; free/monthly/promo titles → immediate alerts + `docs/free.json` / `docs/monthly.json` / `docs/promos.json`)
- `src/promos.ts`: diffs PS Store promo banners (homepage + deals) for new campaigns
- `src/deals.ts`: daily top-30 discounted full games (≥50% off, cheapest first)
- `src/psn.ts`: shared PS Store GraphQL helper
- `src/watchlist.ts`: price checks, target alerts, ≥% off alerts, lowest/highest tracking, breakage alerts
- `src/bot.ts`: Telegram command poller (`/watch`, `/list`, `/price`, `/remove`)
- `src/telegram.ts`: multi-channel sender (Telegram / Discord / ntfy / webhook) + digest queue
- `src/http.ts`: fetch with retry/backoff
- `docs/`: dashboard (`index.html`), price history, state files (committed by the scheduler)
- `scripts/capture-gql.js`: maintenance — re-capture GraphQL hashes if Sony rotates them
- `.github/workflows/deals.yml`: 2-hour scheduler (feeds + promos + watchlist)
- `.github/workflows/daily.yml`: daily top-30 at 07:00 UTC (09:00 France, 08:00 in winter)
- `.github/workflows/bot.yml`: command polling
- `.github/workflows/ci.yml`: type check + lint + format on push/PR
