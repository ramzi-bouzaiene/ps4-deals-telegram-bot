# PS4 Deals Bot

Sends Telegram alerts for PS Plus / free games / deals (RSS feeds) and for price drops on a personal watchlist (PS Store pages). Runs free on GitHub Actions every 2 hours. A small dashboard in `docs/` can be hosted with GitHub Pages.

## Setup

1. **Telegram bot**: message @BotFather, send `/newbot`, copy the token. Send any message to your new bot, then open
   `https://api.telegram.org/bot<TOKEN>/getUpdates` and copy `chat.id`.
2. **Repo**: create a GitHub repo and push this folder.
3. **Secrets**: Settings → Secrets and variables → Actions → add `TG_TOKEN` and `TG_CHAT_ID`.
4. **Watchlist**: edit `watchlist.json` (replace the placeholder URLs with real PS Store game pages from your region, set a target price for each).
5. **Avoid the first-run flood**: run `SEED=1 npm run feeds` locally once and commit `seen.json`.
6. **Run**: Actions tab → "PS4 deals" → Run workflow to test.
7. **Dashboard (optional)**: Settings → Pages → Deploy from a branch → `main` / `/docs`.

## Local testing

```bash
npm install
cp .env.example .env   # fill in values, then: export $(cat .env | xargs)
npm run feeds          # RSS check
npm run debug          # watchlist check, prints the price blocks it found
npm run check          # TypeScript type check
```

Without `TG_TOKEN` / `TG_CHAT_ID` set, messages are printed to the console instead of sent.

## If prices don't show up

PlayStation has no public API. The scraper reads the JSON embedded in store pages (`__NEXT_DATA__`) and looks for `discountedPrice` / `basePrice`. If Sony changes the markup, run `npm run debug` and adjust `fetchPrice` in `src/watchlist.ts`. If GitHub's IPs get blocked, run the same job from a home machine or small VPS with cron.

## Files

- `src/index.ts`: RSS feeds → Telegram (dedupe via `seen.json`)
- `src/watchlist.ts`: price checks, target alerts, lowest-tracked flag
- `src/telegram.ts`: Telegram sender
- `docs/index.html` + `docs/prices.json`: dashboard and price history
- `.github/workflows/deals.yml`: scheduler
