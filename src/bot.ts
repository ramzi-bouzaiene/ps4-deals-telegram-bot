import fs from "fs";
import { notify } from "./telegram";
import { fetchWithRetry, sleep } from "./http";
import { fetchPrice, loadItems, saveItems, type Item } from "./watchlist";

const TOKEN = process.env.TG_TOKEN;
const CHAT_ID = process.env.TG_CHAT_ID;
// How long this process keeps long-polling before exiting (the workflow
// schedule decides when the next one starts).
const SECONDS = Number(process.env.BOT_POLL_SECONDS ?? 240);
const STALE_MS = 24 * 3600 * 1000;
const LIST_FILE = "docs/prices.json";

type Msg = { chat: { id: number }; text?: string; date: number };

const HELP = [
  "🤖 <b>PS4 deals bot — commands</b>",
  "/watch &lt;url&gt; &lt;target&gt; [name] — track a PS Store price",
  "/list — everything you track",
  "/price &lt;n|name&gt; — current price now",
  "/remove &lt;n|name&gt; — stop tracking",
  "/help — this message",
].join("\n");

const titleize = (slug: string) =>
  slug
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();

function deriveName(url: string): string {
  const segs = new URL(url).pathname.split("/").filter(Boolean);
  const last = segs.at(-1) ?? "";
  const prev = segs.at(-2) ?? "";
  if (/^\d+$/.test(last)) {
    // /game/some-slug/123456 → "Some Slug"; /concept/123456 → "Game 123456"
    const region = /^[a-z]{2}(-[a-z]{2})?$/i.test(prev);
    const slug = prev && !/^concept$/i.test(prev) && !region && !/^game$/i.test(prev) ? prev : "";
    return slug ? titleize(slug) : `Game ${last}`;
  }
  return titleize(last) || "Game";
}

function lastKnownPrices(): Record<string, number> {
  try {
    const state = JSON.parse(fs.readFileSync(LIST_FILE, "utf8"));
    const out: Record<string, number> = {};
    for (const [name, s] of Object.entries<any>(state)) {
      const h = s.history;
      if (Array.isArray(h) && h.length) out[name] = h.at(-1).price;
    }
    return out;
  } catch {
    return {};
  }
}

function findItem(items: Item[], arg: string): { item?: Item; index?: number; error?: string } {
  if (/^\d+$/.test(arg)) {
    const i = Number(arg) - 1;
    if (i < 0 || i >= items.length)
      return { error: `No #${arg} — you track ${items.length} item(s).` };
    return { item: items[i], index: i };
  }
  const i = items.findIndex((x) => x.name.toLowerCase() === arg.toLowerCase());
  if (i === -1) return { error: `Nothing called "${arg}". See /list.` };
  return { item: items[i], index: i };
}

export async function handle(text: string): Promise<string> {
  const [rawCmd, ...rest] = text.trim().split(/\s+/);
  const cmd = rawCmd.replace(/@\w+$/, "").toLowerCase();

  if (cmd === "/start" || cmd === "/help") return HELP;

  if (cmd === "/watch") {
    const [url, targetRaw, ...nameParts] = rest;
    if (!url || !targetRaw) return "Usage: /watch &lt;url&gt; &lt;target&gt; [name]";
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return "That doesn't look like a URL. Usage: /watch &lt;url&gt; &lt;target&gt; [name]";
    }
    if (!parsed.hostname.endsWith("playstation.com"))
      return "I can only track store.playstation.com pages.";
    const target = Number(targetRaw);
    if (!Number.isFinite(target) || target < 0)
      return "Target must be a number, e.g. /watch <url> 15";

    const items = loadItems();
    if (items.some((i) => i.url === url)) return `Already tracking:\n${url}`;
    const name = nameParts.join(" ").trim() || deriveName(url);
    items.push({ name, url, target });
    saveItems(items);
    return `✅ Tracking <b>${name}</b> — alert at ≤ ${target}`;
  }

  if (cmd === "/list") {
    const items = loadItems();
    if (!items.length) return "Nothing tracked yet. /watch &lt;url&gt; &lt;target&gt;";
    const prices = lastKnownPrices();
    return (
      "📋 <b>Watchlist</b>\n" +
      items
        .map((i, n) => {
          const p = prices[i.name];
          return `${n + 1}. ${i.name} — target ${i.target}${p !== undefined ? ` (now ${p})` : ""}`;
        })
        .join("\n")
    );
  }

  if (cmd === "/remove") {
    if (!rest.length) return "Usage: /remove &lt;n|name&gt;";
    const items = loadItems();
    const { item, index, error } = findItem(items, rest.join(" "));
    if (error) return error;
    items.splice(index!, 1);
    saveItems(items);
    return `🗑 Removed <b>${item!.name}</b>.`;
  }

  if (cmd === "/price") {
    if (!rest.length) return "Usage: /price &lt;n|name&gt;";
    const items = loadItems();
    const { item, error } = findItem(items, rest.join(" "));
    if (error) return error;
    const r = await fetchPrice(item!.url);
    if (!r.ok) return `Couldn't read a price for ${item!.name}: ${r.reason}`;
    const p = r.price;
    const off =
      p.base && p.base > p.current! ? ` (-${Math.round((1 - p.current! / p.base) * 100)}%)` : "";
    return `🎮 <b>${item!.name}</b>\n${p.free ? "🆓 FREE" : `💸 ${p.current}`}${off} — target: ${item!.target}\n${item!.url}`;
  }

  return `Unknown command. Try /help`;
}

async function getUpdates(offset: number, timeout: number) {
  const url = `https://api.telegram.org/bot${TOKEN}/getUpdates?timeout=${timeout}&offset=${offset}`;
  const res = await fetchWithRetry(url, { signal: AbortSignal.timeout((timeout + 10) * 1000) });
  if (!res.ok) throw new Error(`getUpdates HTTP ${res.status}`);
  const data = (await res.json()) as { ok: boolean; result?: any[] };
  return data.result ?? [];
}

async function main() {
  if (!TOKEN || !CHAT_ID) {
    console.error("TG_TOKEN and TG_CHAT_ID are required to run the command bot.");
    process.exit(1);
  }
  console.log(`Bot polling for ${SECONDS}s...`);
  const deadline = Date.now() + Math.max(SECONDS, 1) * 1000;
  let offset = 0;

  while (Date.now() < deadline) {
    const remaining = Math.ceil((deadline - Date.now()) / 1000);
    const timeout = Math.max(1, Math.min(50, remaining));
    let updates: any[];
    try {
      updates = await getUpdates(offset, timeout);
    } catch (e) {
      console.error("Poll failed:", (e as Error).message);
      await sleep(2000);
      continue;
    }

    for (const u of updates) {
      offset = u.update_id + 1;
      const msg = u.message as Msg | undefined;
      if (!msg?.text) continue;
      if (String(msg.chat.id) !== String(CHAT_ID)) {
        console.log("Ignoring message from unauthorized chat", msg.chat.id);
        continue;
      }
      if (Date.now() - msg.date * 1000 > STALE_MS) continue;
      if (!msg.text.startsWith("/")) continue;
      try {
        await notify(await handle(msg.text));
      } catch (e) {
        console.error("Command failed:", (e as Error).message);
        await notify("💥 Something went wrong running that command.");
      }
    }
  }
  console.log("Poll window finished.");
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
