import type { GameDeal, InlineKeyboard, Preferences, WishlistEntry } from "./types";
import type { RegionConfig } from "./regions";
import type { ScoreResult } from "./scoring";
import type { HistoryStats } from "./price-history";
import { esc } from "./telegram";
import { slugify } from "./util";

export const escTitle = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const money = (n: number, region: RegionConfig) => `${region.symbol}${n.toFixed(2)}`;

export function tnd(price: number, region: RegionConfig, prefs: Preferences): string | null {
  if (!prefs.displayTND || region.currency !== "EUR") return null;
  return `${(price * prefs.tndRate).toFixed(2)} TND`;
}

const NUMBERS = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];

const cbId = (gameId: string) => gameId.slice(0, 46);

export function dealKeyboard(deal: GameDeal): InlineKeyboard {
  return {
    inline_keyboard: [
      [{ text: "🛒 View Deal", url: deal.url }],
      [
        { text: "📊 Price History", callback_data: `whis:${cbId(slugify(deal.title))}` },
        { text: "🔔 Set Alert", callback_data: `wtgt:${cbId(slugify(deal.title))}:5` },
      ],
    ],
  };
}

export function wishlistItemKeyboard(entry: WishlistEntry, index: number): InlineKeyboard {
  const id = cbId(entry.gameId || slugify(entry.title));
  return {
    inline_keyboard: [
      [
        { text: "📉 Price History", callback_data: `whis:${id}` },
        { text: "🔔 Alert", callback_data: `wtgtq:${id}` },
      ],
      [
        ...(entry.url ? [{ text: "🛒 View Deal", url: entry.url }] : []),
        { text: `❌ Remove #${index + 1}`, callback_data: `wdel:${id}` },
      ],
    ],
  };
}

export function settingsKeyboard(prefs: Preferences): InlineKeyboard {
  const on = (b: boolean) => (b ? "✅" : "❌");
  return {
    inline_keyboard: [
      [
        {
          text: `${on(prefs.notifications.historicalLow)} Historical low`,
          callback_data: "st:historicalLow",
        },
        { text: `${on(prefs.notifications.wishlist)} Wishlist`, callback_data: "st:wishlist" },
      ],
      [
        { text: `${on(prefs.notifications.hotDeals)} Hot deals`, callback_data: "st:hotDeals" },
        {
          text: `${on(prefs.notifications.dailyDeals)} Daily deals`,
          callback_data: "st:dailyDeals",
        },
      ],
      [
        { text: "FR", callback_data: "sreg:FR" },
        { text: "DE", callback_data: "sreg:DE" },
        { text: "ES", callback_data: "sreg:ES" },
        { text: "IT", callback_data: "sreg:IT" },
        { text: "UK", callback_data: "sreg:UK" },
        { text: "US", callback_data: "sreg:US" },
      ],
    ],
  };
}

export function targetKeyboard(gameId: string): InlineKeyboard {
  const id = cbId(gameId);
  return {
    inline_keyboard: [
      [
        { text: "🎯 €5", callback_data: `wtgt:${id}:5` },
        { text: "🎯 €10", callback_data: `wtgt:${id}:10` },
        { text: "🎯 €15", callback_data: `wtgt:${id}:15` },
        { text: "🎯 €20", callback_data: `wtgt:${id}:20` },
      ],
      [{ text: "🎯 Free", callback_data: `wtgt:${id}:0` }],
    ],
  };
}

export function priceLine(deal: GameDeal, region: RegionConfig, prefs: Preferences): string {
  const tndLine = tnd(deal.currentPrice, region, prefs);
  return `💰 ${money(deal.currentPrice, region)}${tndLine ? ` (≈ ${tndLine})` : ""}`;
}

export function historicalLowMessage(
  deal: GameDeal,
  score: ScoreResult,
  region: RegionConfig,
  prefs: Preferences,
): string {
  return [
    "🏆 <b>NEW HISTORICAL LOW</b>",
    "",
    `🎮 <b>${esc(deal.title)}</b>`,
    "",
    priceLine(deal, region, prefs),
    `📉 -${deal.discountPercentage}%`,
    "",
    `🔥 Deal Score: ${score.score}/100`,
    "",
    "This is the lowest price recorded by the bot.",
  ].join("\n");
}

export function wishlistAlertMessage(
  entry: { title: string; price: number; targetPrice?: number; discount?: number },
  region: RegionConfig,
  prefs: Preferences,
): string {
  const tndLine = tnd(entry.price, region, prefs);
  const lines = [
    "🔔 <b>WISHLIST ALERT</b>",
    "",
    `🎮 <b>${esc(entry.title)}</b>`,
    "",
    `💰 ${money(entry.price, region)}${tndLine ? ` (≈ ${tndLine})` : ""}`,
  ];
  if (entry.targetPrice !== undefined) lines.push(`🎯 Target: ${money(entry.targetPrice, region)}`);
  if (entry.discount != null) lines.push(`📉 -${entry.discount}%`);
  lines.push("", "Your target price has been reached.");
  return lines.join("\n");
}

export function hotDealMessage(
  deal: GameDeal,
  score: ScoreResult,
  region: RegionConfig,
  prefs: Preferences,
): string {
  const lines = [
    "🔥 <b>HOT PS4 DEAL</b>",
    "",
    `🎮 <b>${esc(deal.title)}</b>`,
    "",
    priceLine(deal, region, prefs),
    `📉 -${deal.discountPercentage}%`,
    "",
  ];
  if (deal.rating != null) lines.push(`⭐ ${deal.rating}/10`);
  lines.push(`🔥 Deal Score: ${score.score}/100`);
  return lines.join("\n");
}

export function dailyDealsMessage(
  deals: { deal: GameDeal; score: ScoreResult }[],
  region: RegionConfig,
): string {
  const date = new Date().toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const lines = [`🏆 <b>BEST PS4 DEALS TODAY</b> — ${date}`, ""];
  deals.forEach((d, i) => {
    lines.push(
      `${NUMBERS[i] ?? `${i + 1}.`} <b>${esc(d.deal.title)}</b>`,
      `${money(d.deal.currentPrice, region)} (-${d.deal.discountPercentage}%)`,
      `${d.score.tier.emoji} ${d.score.score}/100`,
      "",
    );
  });
  return lines.join("\n").trimEnd();
}

export function bestDealsMessage(
  deals: { deal: GameDeal; score: ScoreResult }[],
  region: RegionConfig,
  title = "🏆 <b>BEST PS4 DEALS</b>",
): string {
  const lines = [title, ""];
  deals.forEach((d, i) => {
    lines.push(`${NUMBERS[i] ?? `${i + 1}.`} <b>${esc(d.deal.title)}</b>`);
    lines.push(`💰 ${money(d.deal.currentPrice, region)}`);
    lines.push(`📉 -${d.deal.discountPercentage}%`);
    if (d.deal.rating != null) lines.push(`⭐ ${d.deal.rating}/10`);
    lines.push(`🔥 Deal Score: ${d.score.score}`, "");
  });
  return lines.join("\n").trimEnd();
}

export function wishlistViewMessage(
  entries: {
    entry: WishlistEntry;
    stats: HistoryStats | undefined;
    current?: number;
    original?: number;
  }[],
  region: RegionConfig,
): string {
  if (!entries.length) return "🎮 Your wishlist is empty.\nAdd a game: /add God of War";
  const lines = ["🎮 <b>MY WISHLIST</b>", ""];
  entries.forEach(({ entry, stats, current, original }, i) => {
    const price = current ?? stats?.latest;
    lines.push(`<b>${i + 1}. ${esc(entry.title)}</b>`);
    if (price !== undefined) lines.push(`Current: ${money(price, region)}`);
    if (stats?.lowest !== undefined) lines.push(`Lowest: ${money(stats.lowest, region)}`);
    if (price !== undefined && original !== undefined && original > price)
      lines.push(`Discount: -${Math.round((1 - price / original) * 100)}%`);
    lines.push(`Target: ${money(entry.targetPrice, region)}`, "");
  });
  return lines.join("\n").trimEnd();
}

export function priceHistoryMessage(
  title: string,
  stats: HistoryStats,
  region: RegionConfig,
  prefs: Preferences,
): string {
  const lines = [`📊 <b>PRICE HISTORY</b>`, "", `🎮 <b>${esc(title)}</b>`, ""];
  if (!stats.count)
    return lines.concat("No recorded prices yet — wait for the next check run.").join("\n");
  const lowestPoint = stats.points.reduce((a, b) => (b.price <= a.price ? b : a));
  lines.push(`📉 Lowest: ${money(stats.lowest!, region)} (${lowestPoint.date})`);
  lines.push(`💰 Latest: ${money(stats.latest!, region)}`);
  if (
    stats.nearLow &&
    stats.latest !== undefined &&
    stats.lowest !== undefined &&
    stats.latest > stats.lowest
  )
    lines.push("✅ Near historical low");
  const tndLine = tnd(stats.latest ?? 0, region, prefs);
  if (tndLine) lines.push(`≈ ${tndLine}`);
  lines.push("", "<b>Last changes:</b>");
  for (const p of stats.points.slice(-7).reverse())
    lines.push(`• ${p.date} — ${money(p.price, region)}`);
  return lines.join("\n");
}

export function helpMessage(): string {
  return [
    "🤖 <b>PS4 deals bot — commands</b>",
    "",
    "/deals — current PS4 deals",
    "/best [category] — best deals by score (/best rpg)",
    "/hot — deals scoring ≥ your minimum",
    "/today — today's best deals",
    "/under &lt;price&gt; — best deals under a price (/under 10)",
    "/add &lt;game&gt; — search &amp; wishlist a game",
    "/wishlist — your wishlist with inline buttons",
    "/remove &lt;game|#&gt; — remove from wishlist",
    "/price &lt;game&gt; — current price now",
    "/history &lt;game&gt; — recorded price history",
    "/categories — supported categories",
    "/settings — region, notifications, thresholds",
    "/help — this message",
  ].join("\n");
}
