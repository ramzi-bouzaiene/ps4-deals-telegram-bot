export async function notify(text: string) {
  if (!process.env.TG_TOKEN || !process.env.TG_CHAT_ID) {
    console.log("[dry-run, no TG_TOKEN/TG_CHAT_ID]", text);
    return;
  }
  const res = await fetch(`https://api.telegram.org/bot${process.env.TG_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: process.env.TG_CHAT_ID,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: false,
    }),
  });
  if (!res.ok) console.error("Telegram error", res.status, await res.text());
}

export const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
