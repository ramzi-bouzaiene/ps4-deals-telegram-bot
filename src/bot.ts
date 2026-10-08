import { handleCommand, handleCallback } from "./commands";
import { notify, answerCallbackQuery } from "./telegram";
import { fetchWithRetry, sleep } from "./http";

const TOKEN = process.env.TG_TOKEN;
const CHAT_ID = process.env.TG_CHAT_ID;
// How long this process keeps long-polling before exiting (the workflow
// schedule decides when the next one starts).
const SECONDS = Number(process.env.BOT_POLL_SECONDS ?? 240);
const STALE_MS = 24 * 3600 * 1000;

type Msg = { chat: { id: number }; text?: string; date: number };
type CallbackQuery = { id: string; data?: string; message?: { chat?: { id?: number } } };

async function getUpdates(offset: number, timeout: number) {
  const url = `https://api.telegram.org/bot${TOKEN}/getUpdates?timeout=${timeout}&offset=${offset}`;
  const res = await fetchWithRetry(url, { signal: AbortSignal.timeout((timeout + 10) * 1000) });
  if (!res.ok) throw new Error(`getUpdates HTTP ${res.status}`);
  const data = (await res.json()) as { ok: boolean; result?: any[] };
  return data.result ?? [];
}

const authorized = (id: unknown) => String(id) === String(CHAT_ID);

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

      const cb = u.callback_query as CallbackQuery | undefined;
      if (cb) {
        if (!authorized(cb.message?.chat?.id)) {
          console.log("Ignoring callback from unauthorized chat", cb.message?.chat?.id);
          continue;
        }
        if (!cb.data) continue;
        await answerCallbackQuery(cb.id);
        try {
          const reply = await handleCallback(cb.data);
          await notify(reply.text, reply.keyboard);
        } catch (e) {
          console.error("Callback failed:", (e as Error).message);
          await notify("💥 Something went wrong with that button.");
        }
        continue;
      }

      const msg = u.message as Msg | undefined;
      if (!msg?.text) continue;
      if (!authorized(msg.chat.id)) {
        console.log("Ignoring message from unauthorized chat", msg.chat.id);
        continue;
      }
      if (Date.now() - msg.date * 1000 > STALE_MS) continue;
      if (!msg.text.startsWith("/")) continue;
      try {
        const reply = await handleCommand(msg.text);
        await notify(reply.text, reply.keyboard);
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
