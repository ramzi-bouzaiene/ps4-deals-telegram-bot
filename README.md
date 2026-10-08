# PS4 Deals Bot

Sends Telegram alerts for PS Plus / free games / deals (RSS feeds) and for price drops on a personal watchlist (PS Store pages). Runs free on GitHub Actions every 2 hours. A small dashboard in `docs/` can be hosted with GitHub Pages — it lists currently free games (`Free right now`), tracked prices, and recent free-game news.

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
cp .env.example .env   # fill in values, then: export $(cat .env | xargs)
npm run feeds          # RSS check
npm run debug          # watchlist check, prints the price blocks it found
npm run bot            # poll Telegram for commands (BOT_POLL_SECONDS to bound it)
npm run check          # TypeScript type check
npm run lint           # ESLint
npm run format:check   # Prettier
```

Without a notification channel configured, messages are printed to the console instead of sent.

## If prices don't show up

PlayStation has no public API. The scraper reads the JSON embedded in store pages (`__NEXT_DATA__`, including the `<script type="application/json">` blobs inside `batarangs.*.text`) and picks the cheapest standard purchase price, ignoring PS Plus "Inclus" subscription upsells. If Sony changes the markup, the bot pings you with a ⚠️ breakage alert (once per game per day) — run `npm run debug` and adjust `fetchPrice` in `src/watchlist.ts`. If GitHub's IPs get blocked, run the same job from a home machine or small VPS with cron.

## Files

- `src/index.ts`: RSS feeds → Telegram (dedupe via `seen.json`, free-game titles → immediate alert + `docs/free.json`)
- `src/watchlist.ts`: price checks, target alerts, ≥% off alerts, lowest/highest tracking, breakage alerts
- `src/bot.ts`: Telegram command poller (`/watch`, `/list`, `/price`, `/remove`)
- `src/telegram.ts`: multi-channel sender (Telegram / Discord / ntfy / webhook) + digest queue
- `src/http.ts`: fetch with retry/backoff
- `docs/index.html` + `docs/prices.json` + `docs/meta.json` + `docs/free.json`: dashboard, price history, last run, free-game news
- `.github/workflows/deals.yml`: scheduler
- `.github/workflows/bot.yml`: command polling
- `.github/workflows/ci.yml`: type check + lint + format on push/PR
