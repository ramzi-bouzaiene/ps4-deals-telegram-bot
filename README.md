# PS4 Deals Bot

Telegram bot for PS4 deals, wishlist price alerts, PS Plus free games and store promotions. Runs free on GitHub Actions, stores everything as JSON (no database), and keeps a small dashboard in `docs/` for GitHub Pages.

## Features

### Deals & scoring

- **PS Store deal source** — replays Sony's public web GraphQL (promo category grid) for the selected region: `FR DE ES IT UK US`, **PS4 titles only**, with anti-shovelware filters (price ≥ €0.99, discount ≥ 50%, original price ≥ 5).
- **Pluggable `DealSource` interface** (`src/types.ts`) — each source fetches independently; one failing source never stops the others or the workflow.
- **Shared deals cache** — `data/current-deals.json` reused for 30+ min by all workflows and bot commands (no duplicate API requests).
- **Deal Score 0–100** — weighted, normalized over available factors (discount, price, historical low, price drop, rating, popularity); 4 tiers from 👍 GOOD to 🔥🔥 INSANE; weights editable in `config/preferences.json`.
- **Categories** — static game→category map (`config/categories.json`, 11 spec categories) powering `/best <category>` and `/categories`.

### Alerts (anti-spam by design)

- **New historical low** — a tracked/discounted game drops below the lowest price this bot ever recorded (first sighting is silent).
- **Wishlist target alert** — a wishlist game reaches your target price.
- **Hot deal alert** — score ≥ your minimum (default 80), **max 5 per run**.
- **Daily top-N** — every day: the best N deals (default 5) by score.
- **Store promotions / monthly PS Plus / free games** — from promo diffs and RSS; PS Plus games get store links resolved via search (no links in PS Blog posts).
- **Anti-spam state** — `data/notification-state.json`: notify only when the price drops below the last notified price; a sale ending (price back up ≥ 10%) re-arms silently; **first run seeds silently** (no alert burst).
- **Scraper breakage alerts** — ⚠️ per game per 24 h when store-page price scraping breaks, plus a 24 h `system:source-down` warning when all sources fail.
- **Optional digest mode** — `DIGEST=1` queues non-urgent news during `QUIET_HOURS`, one combined message after; urgent alerts always go immediately.
- **Multi-channel** — Telegram (with inline buttons), plus optional Discord webhook / ntfy.sh / generic webhook.

### Bot & commands

- **14 chat commands** with inline-keyboard flows (add → confirm → set target; wishlist rows with 📉 history · 🔔 alert · 🛒 deal · ❌ remove).
- **Stateless polling with persisted pending state** — in-flight `/add` confirmations survive the 5-min poll gap (`data/pending-adds.json`, 30 min TTL).
- **Settings from chat** — `/settings` toggles notification types and switches region; edits are saved to `config/preferences.json` and committed.
- **Authorized chat only** — only `TG_CHAT_ID` may talk to the bot; errors reply with a friendly message, never stack traces.
- **First-run migration** — legacy France `watchlist.json` moves to `data/wishlist.json` automatically.

### Infrastructure

- **No database** — every state file is JSON, committed by the workflows (works on ephemeral runners).
- **GitHub Actions** — `check-deals` every 30 min, `daily-deals` daily, `price-history` every 6 h, `rss` every 2 h, `bot` every 5 min, `ci` on push; each commit step retries with `pull --rebase`.
- **Secrets stay secrets** — tokens only from GitHub Secrets or gitignored `.env`; never in code, logs or committed files.
- **Dashboard** — `docs/index.html` + state files (GitHub Pages).
- **Health checks** — `debug` mode, dry-run mode (no channel configured), `DATA_DIR` override for isolated tests.

## What it sends

| Alert                          | When                                                                                          |
| ------------------------------ | --------------------------------------------------------------------------------------------- |
| 🏆 **New historical low**      | a tracked/discounted game drops below the lowest price this bot ever recorded                 |
| 🔔 **Wishlist alert**          | a wishlist game reaches your target price                                                     |
| 🔥 **Hot PS4 deal**            | a deal scores ≥ your minimum (default 80) — max 5 per run, never repeated for the same price  |
| 🏆 **Daily best deals**        | every day at 07:00 UTC: the top N (default 5) deals by score, only genuinely good ones        |
| 📣 **New PS Store promotions** | a new promo banner/campaign appears, or an official sale announcement on the PlayStation Blog |
| 🗓 **Monthly PS Plus games**    | Sony announces the monthly PS Plus lineup, with store links resolved from search              |
| 🆓 **Free games**              | free-to-play releases and “free” titles in the RSS feeds, immediately                         |

## Setup

1. **Telegram bot**: message @BotFather, send `/newbot`, copy the token. Send any message to your new bot, then open
   `https://api.telegram.org/bot<TOKEN>/getUpdates` and copy `chat.id`.
2. **Repo**: create a GitHub repo and push this folder.
3. **Secrets**: Settings → Secrets and variables → Actions → add `TG_TOKEN` and `TG_CHAT_ID`. The token never appears in code, logs or committed files (`.env` is gitignored).
4. **Wishlist**: the bot starts from the entries in `data/wishlist.json` (the old `watchlist.json` migrates there automatically on first run). Manage it from chat with `/add` and `/wishlist`.
5. **Avoid the first-run flood**: run `SEED=1 npm run feeds` locally once and commit `seen.json`.
6. **Run**: Actions tab → check-deals / daily-deals → Run workflow to test.
7. **Dashboard (optional)**: Settings → Pages → Deploy from a branch → `main` / `/docs`.

## Bot commands

The bot workflow long-polls Telegram every 5 minutes (only `TG_CHAT_ID` is authorized):

| Command            | What it does                                                                    |
| ------------------ | ------------------------------------------------------------------------------- |
| `/start`, `/help`  | command overview                                                                |
| `/deals`           | current PS4 deals (score ≥ 60)                                                  |
| `/best [category]` | best deals sorted by deal score — `/best rpg`, `/best action`, `/best horror` … |
| `/hot`             | deals scoring ≥ your minimum (default 80)                                       |
| `/today`           | today's best deals (same selection as the daily message, with buttons)          |
| `/under <price>`   | best deals under a price — `/under 10`                                          |
| `/add <game>`      | searches the store, then one tap adds it to your wishlist                       |
| `/wishlist`        | your games with inline buttons: 📉 history · 🔔 alert · 🛒 deal · ❌ remove     |
| `/remove <game/#>` | remove from the wishlist                                                        |
| `/price <game>`    | current price right now (store search)                                          |
| `/history <game>`  | recorded price history (lowest / latest / last changes)                         |
| `/categories`      | supported categories with live deal counts                                      |
| `/settings`        | inline toggles for notifications and region (FR DE ES IT UK US)                 |

### Inline buttons (callbacks)

| Button / callback               | Effect                                                             |
| ------------------------------- | ------------------------------------------------------------------ |
| ✅ **Add to Wishlist** (`wadd`) | confirms an `/add` search (expired → “send /add again”)            |
| ❌ **Cancel** (`wcan`)          | drops the pending add                                              |
| ❌ **Remove** (`wdel`)          | removes the game from the wishlist                                 |
| 🔔 **Alert** (`wtgtq`)          | opens the target picker: €5 €10 €15 €20 Free                       |
| 🎯 **€X / Free** (`wtgt`)       | sets the target price (auto-adds a deal that isn't wishlisted yet) |
| 📉 **Price History** (`whis`)   | shows recorded history for the game                                |
| ⚙️ settings row (`st`)          | toggles a notification type                                        |
| region row (`sreg`)             | switches the region (reloads deals + settings view)                |

Example: send `/add Red Dead Redemption 2` → the bot shows the store match → tap **Add to Wishlist** → set a target with the 🔔 buttons. Wishlist edits made in chat are committed back automatically.

Private repos: change the bot cron to `*/15` and `BOT_POLL_SECONDS` to `860` to save Actions minutes.

## Deal sources

Sources implement one interface and return normalized data (`src/types.ts`):

```ts
interface DealSource {
  name: string;
  regions: string[];
  fetchDeals(): Promise<GameDeal[]>;
}
```

`GameDeal` carries id, title, platform, store, region, current/original price, currency, discount %, URL, optional image/rating/popularity/expiry. The current source is `psn-store` (`src/sources/psn-store.ts`): it replays the PS Store's own public web GraphQL (promo category grid) for the configured region, keeps **PS4 titles only** (PS5-only games are ignored), accepts full-game classifications only (`FULL_GAME`, `GAME_BUNDLE`, `PREMIUM_EDITION` + FR variants — `src/product-classes.ts`), deduplicates by title (keeps the cheaper one) and declares `regions: [FR, DE, ES, IT, UK, US]`.

To add a source: create `src/sources/<name>.ts`, export a factory `(region) => DealSource`, add it to `FACTORIES` in `src/sources/index.ts`. Every source is fetched independently — if one fails the others still run and the workflow continues.

Shared cache: `data/current-deals.json` stores the last fetch; all workflows and bot commands reuse it for 30+ minutes instead of hitting the API again. Only legitimate, publicly accessible data is used — no piracy/torrent/cracked sources — and requests are rate-limited (paged with delays).

## Deal score

`calculateDealScore(deal, history, weights)` in `src/scoring.ts` returns 0–100 from configurable weights (`config/preferences.json → scoreWeights`): discount %, current price, distance from the historical low, price drop vs. the previous check, Metacritic-style rating, popularity. Factors a source doesn't provide are left out (including “no drop this check”) and the remaining weights are normalized.

| Score  | Tier             | Shown in alerts |
| ------ | ---------------- | --------------- |
| 90–100 | 🔥🔥 INSANE DEAL | yes             |
| 80–89  | 🔥 HOT DEAL      | yes (≥ minimum) |
| 70–79  | ⭐ GREAT DEAL    | lists           |
| 60–69  | 👍 GOOD DEAL     | lists           |
| < 60   | ignored          | no              |

`minimumDealScore` (default 80) gates hot alerts and the daily selection; lists (`/best`, `/hot`, `/under`, `/today`) show 60+.

## Configuration

**`config/preferences.json`** (committed, editable in chat via `/settings`):

```json
{
  "region": "FR",
  "currency": "EUR",
  "displayTND": false,
  "tndRate": 3.35,
  "minimumDealScore": 80,
  "dailyDealsCount": 5,
  "notifications": {
    "historicalLow": true,
    "wishlist": true,
    "hotDeals": true,
    "dailyDeals": true
  },
  "scoreWeights": {
    "discount": 30,
    "price": 20,
    "historical": 25,
    "drop": 15,
    "rating": 10,
    "popularity": 0
  }
}
```

Regions: `FR DE ES IT UK US` (currency/price locale follow the region; sources declare which regions they support). `displayTND` appends an approximate TND line using `tndRate` (EUR→TND — keep it current yourself; no FX API is called).

**GitHub Actions variables** (Settings → Secrets and variables → Actions → Variables):

| Variable         | Default     | Effect                                                                            |
| ---------------- | ----------- | --------------------------------------------------------------------------------- |
| `DEFAULT_REGION` | `FR`        | overrides `preferences.region`                                                    |
| `DIGEST`         | off         | `1` = queue non-urgent alerts during quiet hours, send one combined message after |
| `QUIET_HOURS`    | `22-8`      | hours (UTC, GitHub's clock) when `DIGEST` holds messages back                     |
| `FEEDS`          | built-ins   | comma-separated RSS URLs, replaces the default feed list                          |
| `KEYWORDS`       | PS keywords | case-insensitive regex that RSS titles must match                                 |

Secrets (optional, can be combined with Telegram):

| Secret                     | Effect                                  |
| -------------------------- | --------------------------------------- |
| `DISCORD_WEBHOOK`          | also post to a Discord channel          |
| `NTFY_URL` or `NTFY_TOPIC` | also post via ntfy.sh                   |
| `WEBHOOK_URL`              | POST `{ text, content }` to any webhook |

Urgent alerts (historical low, wishlist hit, hot deal, free game, scraper breakage) always go out immediately; other RSS news is digest-eligible. Discord/ntfy/webhook channels receive the same text without buttons.

## Data files (no database, committed by the workflows)

| File                           | Contents                                                 |
| ------------------------------ | -------------------------------------------------------- |
| `data/wishlist.json`           | your wishlist: `{ gameId, title, targetPrice, url }`     |
| `data/price-history.json`      | one price point per day per game — the score's "history" |
| `data/notification-state.json` | anti-spam: last notified price per `gameId:type`         |
| `data/current-deals.json`      | shared deals cache (avoids duplicate API requests)       |
| `data/pending-adds.json`       | in-flight `/add` confirmations (30 min TTL)              |
| `config/preferences.json`      | region, thresholds, notifications, score weights         |
| `config/categories.json`       | game → categories map for `/best <category>`             |
| `docs/*`                       | dashboard state (free games, promos, prices, meta)       |

Never put secrets in these files, in `.env` or in code — workflows only read tokens from GitHub Secrets.

## GitHub Actions workflows

| Workflow            | Schedule        | Does                                                                                             |
| ------------------- | --------------- | ------------------------------------------------------------------------------------------------ |
| `check-deals.yml`   | every 30 min    | fetch deals → score → update history → detect lows/targets/hots → Telegram alerts → commit state |
| `daily-deals.yml`   | daily 07:00 UTC | fetch (or reuse cache) → top N by score → send 🏆 message                                        |
| `price-history.yml` | every 6 h       | update historical prices only (no notifications) → commit                                        |
| `rss.yml`           | every 2 h       | RSS free games / monthly PS Plus / store promotions → commit                                     |
| `bot.yml`           | every 5 min     | long-poll Telegram commands & inline buttons → commit wishlist/settings                          |
| `ci.yml`            | push/PR         | type check + lint + format                                                                       |

Each commit step retries with `pull --rebase` so parallel workflows don't lose state; each workflow has its own concurrency group.

## Local testing

```bash
npm install
cp .env.example .env   # fill in values (scripts load it automatically)

# static checks
npm run check          # TypeScript type check
npm run lint           # ESLint
npm run format:check   # Prettier

# dry-runs: real API, isolated state, no Telegram (prints instead of sending)
DATA_DIR=/tmp/tbot TG_TOKEN= TG_CHAT_ID= npm run check-deals
DATA_DIR=/tmp/tbot TG_TOKEN= TG_CHAT_ID= npm run daily-deals
DATA_DIR=/tmp/tbot TG_TOKEN= TG_CHAT_ID= npm run price-history
DATA_DIR=/tmp/tbot TG_TOKEN= TG_CHAT_ID= npm run feeds

# real runs (send actual messages if .env has TG_* values)
npm run check-deals    # full pipeline: fetch, score, history, alerts
DEBUG=1 npm run check-deals  # same + verbose scoring log
npm run daily-deals    # send today's top list now
npm run price-history  # update data/price-history.json only
npm run feeds          # RSS check (free games, monthly PS Plus, promos)
npm run promos         # check the store for new promotion banners
npm run bot            # poll Telegram for commands (BOT_POLL_SECONDS to bound it)
```

Without a notification channel configured, messages are printed to the console instead of sent. To test without touching real state, point `DATA_DIR` somewhere temporary — it overrides the default `data/` for every data file (state only; config still lives in `config/`).

## If promotions stop updating

The promo/deal features replay Sony's internal GraphQL endpoint with fixed hashes (tied to the store web app version). If Sony rotates them you'll get a ⚠️ alert. To re-capture: `npm i playwright --no-save && npx playwright install chromium && node scripts/capture-gql.js`, then paste the printed hash/URL into `src/promos.ts` / `src/sources/psn-store.ts` / `src/search.ts`.

## If prices don't show up

PlayStation has no public API. Wishlist prices are read two ways: from the deal feed when the game is on sale, and from the JSON embedded in its store page (`__NEXT_DATA__`, including the `<script type="application/json">` blobs inside `batarangs.*.text`) otherwise — the cheapest standard purchase price, ignoring PS Plus "Inclus" upsells. If Sony changes the markup, the bot pings you with a ⚠️ breakage alert (once per game per 24 h) — run `npm run debug` and adjust `fetchPrice` in `src/watchlist.ts`. If GitHub's IPs get blocked, run the same job from a home machine or small VPS with cron.

## Files

- `src/types.ts`: `GameDeal`, `DealSource`, preferences/wishlist/history shapes
- `src/sources/psn-store.ts`: PS Store GraphQL source (PS4-only, region-aware, anti-shovelware filters)
- `src/sources/index.ts`: source registry, per-source error isolation, shared cache
- `src/product-classes.ts`: store classifications treated as a full game (grid + search)
- `src/scoring.ts`: `calculateDealScore` + tiers
- `src/price-history.ts`: `data/price-history.json` (seeds from legacy `docs/prices.json`) + history CLI
- `src/wishlist.ts`: `data/wishlist.json` (migrates legacy `watchlist.json`)
- `src/notify-state.ts`: anti-spam gate (`shouldNotify` / `markSent`)
- `src/check.ts`: scheduled pipeline (`npm run check-deals`)
- `src/daily.ts`: daily top-N message (`npm run daily-deals`)
- `src/commands.ts` + `src/bot.ts`: chat commands, inline buttons, callbacks
- `src/pending.ts`: in-flight `/add` confirmations (30 min TTL)
- `src/search.ts`: store search for `/add` `/price`
- `src/format.ts`: message templates + keyboards
- `src/categories.ts` + `config/categories.json`: category filtering
- `src/preferences.ts` + `config/preferences.json`: configuration
- `src/regions.ts`: region/currency/locale table
- `src/promos.ts`, `src/index.ts`: promo banner diffs, RSS feeds
- `src/telegram.ts`: multi-channel sender (Telegram / Discord / ntfy / webhook) + digest queue
- `docs/`: dashboard (`index.html`) and its state files
- `scripts/capture-gql.js`: maintenance — re-capture GraphQL hashes if Sony rotates them
