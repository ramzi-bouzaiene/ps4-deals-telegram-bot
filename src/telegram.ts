import fs from "fs";
import { fetchWithRetry } from "./http";

const DIGEST_FILE = "digest.json";
const TG_LIMIT = 4096;

export const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Plain text for channels that don't understand Telegram HTML.
export const plain = (s: string) =>
  s
    .replace(/<\/?b>/g, "**")
    .replace(/<\/?i>/g, "*")
    .replace(/<\/?code>/g, "`")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

/** Split on line boundaries so no chunk exceeds the Telegram limit. */
function chunk(text: string, limit = TG_LIMIT): string[] {
  if (text.length <= limit) return [text];
  const out: string[] = [];
  let cur = "";
  for (const line of text.split("\n")) {
    if ((cur + "\n" + line).length > limit && cur) {
      out.push(cur);
      cur = "";
    }
    cur = cur ? cur + "\n" + line : line;
  }
  if (cur) out.push(cur);
  return out;
}

const hasTg = () => Boolean(process.env.TG_TOKEN && process.env.TG_CHAT_ID);

async function sendTelegram(text: string) {
  for (const part of chunk(text)) {
    const res = await fetchWithRetry(
      `https://api.telegram.org/bot${process.env.TG_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: process.env.TG_CHAT_ID,
          text: part,
          parse_mode: "HTML",
          disable_web_page_preview: false,
        }),
      },
    );
    if (!res.ok) console.error("Telegram error", res.status, await res.text());
  }
}

async function sendDiscord(text: string) {
  const res = await fetchWithRetry(process.env.DISCORD_WEBHOOK!, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: plain(text).slice(0, 1900) }),
  });
  if (!res.ok) console.error("Discord error", res.status, await res.text());
}

async function sendNtfy(text: string) {
  const url = process.env.NTFY_URL ?? `https://ntfy.sh/${process.env.NTFY_TOPIC}`;
  const res = await fetchWithRetry(url, {
    method: "POST",
    headers: { Title: "PS4 Deals", Tags: "video_game" },
    body: plain(text),
  });
  if (!res.ok) console.error("ntfy error", res.status, await res.text());
}

async function sendWebhook(text: string) {
  const res = await fetchWithRetry(process.env.WEBHOOK_URL!, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: plain(text), content: plain(text) }),
  });
  if (!res.ok) console.error("Webhook error", res.status, await res.text());
}

async function sendAll(text: string) {
  const targets: (() => Promise<void>)[] = [];
  if (hasTg()) targets.push(() => sendTelegram(text));
  if (process.env.DISCORD_WEBHOOK) targets.push(() => sendDiscord(text));
  if (process.env.NTFY_URL || process.env.NTFY_TOPIC) targets.push(() => sendNtfy(text));
  if (process.env.WEBHOOK_URL) targets.push(() => sendWebhook(text));

  if (!targets.length) {
    console.log("[dry-run, no notification channel configured]", text);
    return;
  }
  for (const t of targets) {
    try {
      await t();
    } catch (e) {
      console.error("Notification failed:", (e as Error).message);
    }
  }
}

/** Urgent alert: delivered immediately, never queued. */
export async function notify(text: string) {
  await sendAll(text);
}

// --- digest / quiet hours -------------------------------------------------

const digestEnabled = () => process.env.DIGEST === "1";

/** QUIET_HOURS="22-8" (hours, UTC — GitHub Actions' clock). */
function quietWindow(): [number, number] {
  const m = (process.env.QUIET_HOURS ?? "22-8").match(/^(\d{1,2})-(\d{1,2})$/);
  if (!m) return [22, 8];
  return [Math.min(+m[1], 23), Math.min(+m[2], 23)];
}

export function inQuietHours(now = new Date()): boolean {
  const [start, end] = quietWindow();
  const h = now.getUTCHours();
  return start < end ? h >= start && h < end : h >= start || h < end;
}

function readDigest(): string[] {
  try {
    const v = JSON.parse(fs.readFileSync(DIGEST_FILE, "utf8"));
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function writeDigest(items: string[]) {
  fs.writeFileSync(DIGEST_FILE, JSON.stringify(items, null, 2));
}

/**
 * Non-urgent alert. With DIGEST=1 it is queued during quiet hours and sent
 * as one combined message once quiet hours are over. Without DIGEST it is
 * sent immediately (original behaviour).
 */
export async function enqueue(text: string) {
  if (!digestEnabled()) return sendAll(text);
  const items = readDigest();
  items.push(text);
  writeDigest(items.slice(-200));
}

/** Send whatever is queued, once quiet hours are over. Call at the end of every run. */
export async function flushDigest() {
  const items = readDigest();
  if (!items.length) return;
  if (digestEnabled() && inQuietHours()) return;
  writeDigest([]);
  const header = `📋 <b>Digest</b> — ${items.length} update${items.length > 1 ? "s" : ""}`;
  await sendAll(header + "\n\n" + items.map((t) => t.trim()).join("\n\n"));
}
