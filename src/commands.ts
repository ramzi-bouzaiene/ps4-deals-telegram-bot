import type { GameDeal, InlineKeyboard, Preferences } from "./types";
import type { RegionConfig } from "./regions";
import { loadPreferences, savePreferences } from "./preferences";
import { getRegion } from "./regions";
import { loadPriceHistory, historyStats, findHistoryKey } from "./price-history";
import {
  loadWishlist,
  addToWishlist,
  removeFromWishlist,
  setTargetPrice,
  findWishlistEntry,
} from "./wishlist";
import { calculateDealScore } from "./scoring";
import type { ScoreResult } from "./scoring";
import { getDeals } from "./sources";
import { searchProducts, pickBestMatch } from "./search";
import { CATEGORIES, isValidCategory, categoriesFor, categoryCounts } from "./categories";
import * as fmt from "./format";
import { savePending, takePending } from "./pending";
import { slugify, titleize } from "./util";

export type Reply = { text: string; keyboard?: InlineKeyboard };

type Scored = { deal: GameDeal; score: ScoreResult };

async function scoredDeals(prefs: Preferences): Promise<Scored[]> {
  const { deals, errors } = await getDeals({ region: prefs.region, maxAgeMs: 30 * 60 * 1000 });
  if (errors.length && !deals.length)
    throw new Error(errors.map((e) => `${e.source}: ${e.error}`).join("; "));
  const history = loadPriceHistory();
  return deals
    .map((deal) => ({
      deal,
      score: calculateDealScore(
        deal,
        historyStats(slugify(deal.title), history),
        prefs.scoreWeights,
      ),
    }))
    .sort((a, b) => b.score.score - a.score.score);
}

function compactList(items: Scored[], region: RegionConfig, title: string): string {
  const lines = [title, ""];
  items.forEach((d, i) => {
    lines.push(
      `${i + 1}. <b>${fmt.escTitle(d.deal.title)}</b> — ${fmt.money(d.deal.currentPrice, region)} ` +
        `(-${d.deal.discountPercentage}%) ${d.score.tier.emoji} ${d.score.score}`,
    );
    lines.push(d.deal.url);
  });
  return lines.join("\n");
}

function dealList(items: Scored[], region: RegionConfig, title: string): Reply {
  if (!items.length)
    return {
      text: `Nothing above the quality bar in ${title.replace(/<[^>]+>/g, "")} right now. Try /deals for the full list.`,
    };
  return { text: fmt.bestDealsMessage(items, region, title) };
}

export async function handleCommand(text: string): Promise<Reply> {
  const prefs = loadPreferences();
  const region = getRegion(prefs.region);
  const [rawCmd, ...restParts] = text.trim().split(/\s+/);
  const cmd = rawCmd.replace(/@\w+$/, "").toLowerCase();
  const rest = restParts.join(" ").trim();

  if (cmd === "/start" || cmd === "/help") return { text: fmt.helpMessage() };

  if (cmd === "/deals") {
    const items = (await scoredDeals(prefs)).filter((d) => d.score.score >= 60).slice(0, 15);
    if (!items.length)
      return {
        text: "No current PS4 deals above score 60. The promo grid may be empty — see README.",
      };
    return { text: compactList(items, region, `🎮 <b>CURRENT PS4 DEALS</b> — ${prefs.region}`) };
  }

  if (cmd === "/best") {
    let items = (await scoredDeals(prefs)).filter((d) => d.score.score >= 60);
    let title = "🏆 <b>BEST PS4 DEALS</b>";
    if (rest) {
      if (!isValidCategory(rest))
        return {
          text: `Unknown category "${esc(rest)}".\nSupported: ${CATEGORIES.join(", ")}`,
        };
      const wanted = rest.toLowerCase().replace(/\s/g, "");
      items = items.filter((d) =>
        categoriesFor(d.deal.title).some((c) => c.replace(/\s/g, "") === wanted),
      );
      title = `🏆 <b>BEST PS4 DEALS — ${rest.toUpperCase()}</b>`;
    }
    return dealList(items.slice(0, 10), region, title);
  }

  if (cmd === "/hot") {
    const items = (await scoredDeals(prefs))
      .filter((d) => d.score.score >= prefs.minimumDealScore)
      .slice(0, 10);
    return dealList(items, region, `🔥 <b>HOT PS4 DEALS</b> (score ≥ ${prefs.minimumDealScore})`);
  }

  if (cmd === "/today") {
    const items = (await scoredDeals(prefs))
      .filter((d) => d.score.score >= prefs.minimumDealScore)
      .slice(0, prefs.dailyDealsCount);
    if (!items.length)
      return {
        text: `No deals ≥ ${prefs.minimumDealScore} right now — nothing qualifies for today's list.`,
      };
    return {
      text: fmt.dailyDealsMessage(items, region),
      keyboard: {
        inline_keyboard: items.map((d, i) => [
          { text: `${i + 1}. ${d.deal.title}`, url: d.deal.url },
        ]),
      },
    };
  }

  if (cmd === "/under") {
    const price = Number(rest.replace(",", "."));
    if (!rest || !Number.isFinite(price) || price < 0)
      return { text: "Usage: /under 10 (or /under 5, /under 15, /under 20)" };
    const items = (await scoredDeals(prefs))
      .filter((d) => d.score.score >= 60 && d.deal.currentPrice < price)
      .slice(0, 10);
    return dealList(items, region, `🎮 <b>BEST PS4 GAMES UNDER ${fmt.money(price, region)}</b>`);
  }

  if (cmd === "/add") {
    if (!rest) return { text: "Usage: /add Red Dead Redemption 2" };
    const results = await searchProducts(rest, prefs.region, 5);
    const best = pickBestMatch(rest, results);
    if (!best) return { text: `No PS4 game found for "${esc(rest)}" in region ${prefs.region}.` };
    const slot = String(Date.now()).slice(-9);
    const target = best.free ? 0 : best.currentPrice;
    savePending(slot, { ...best, targetPrice: target, expiresAt: Date.now() + 30 * 60 * 1000 });
    const priceLine = best.free
      ? "🆓 FREE"
      : `💰 ${fmt.money(best.currentPrice, region)}${best.discountPercentage ? ` (-${best.discountPercentage}%)` : ""}`;
    return {
      text: `🔍 <b>Found:</b>\n\n🎮 <b>${esc(best.title)}</b>\n${priceLine}\n\nTap to add with target ${fmt.money(target, region)} (change later via 🔔 in /wishlist).`,
      keyboard: {
        inline_keyboard: [
          [{ text: "✅ Add to Wishlist", callback_data: `wadd:${slot}` }],
          [{ text: "🛒 View Deal", url: best.url }],
        ],
      },
    };
  }

  if (cmd === "/wishlist") return wishlistReply(prefs, region);

  if (cmd === "/remove") {
    if (!rest) return { text: "Usage: /remove &lt;game|#&gt; — see /wishlist for numbers" };
    const { entry } = findWishlistEntry(rest);
    if (!entry) return { text: `Nothing called "${esc(rest)}" on your wishlist. See /wishlist.` };
    removeFromWishlist(entry.gameId);
    return { text: `🗑 Removed <b>${esc(entry.title)}</b> from your wishlist.` };
  }

  if (cmd === "/price") {
    if (!rest) return { text: "Usage: /price God of War" };
    const results = await searchProducts(rest, prefs.region, 5);
    const best = pickBestMatch(rest, results);
    if (!best) return { text: `No PS4 game found for "${esc(rest)}".` };
    const { entry } = findWishlistEntry(best.title);
    const lines = [`💰 <b>${esc(best.title)}</b>`, ""];
    lines.push(
      best.free
        ? "🆓 FREE"
        : `Current: ${fmt.money(best.currentPrice, region)}${best.discountPercentage ? ` (-${best.discountPercentage}%)` : ""}`,
    );
    if (!best.free && best.originalPrice > best.currentPrice)
      lines.push(`Original: ${fmt.money(best.originalPrice, region)}`);
    if (entry) lines.push(`🎯 Your target: ${fmt.money(entry.targetPrice, region)}`);
    lines.push("", best.url);
    return {
      text: lines.join("\n"),
      keyboard: entry
        ? fmt.wishlistItemKeyboard(entry, 0)
        : { inline_keyboard: [[{ text: "🛒 View Deal", url: best.url }]] },
    };
  }

  if (cmd === "/history") {
    if (!rest) return { text: "Usage: /history Red Dead Redemption 2" };
    const { entry } = findWishlistEntry(rest);
    const key = entry?.gameId ?? findHistoryKey(rest);
    if (!key)
      return {
        text: `No recorded prices for "${esc(rest)}" yet — they appear after the first check run.`,
      };
    const stats = historyStats(key, loadPriceHistory());
    const title = entry?.title ?? titleize(key);
    return { text: fmt.priceHistoryMessage(title, stats, region, prefs) };
  }

  if (cmd === "/categories") {
    const deals = (await scoredDeals(prefs)).map((d) => d.deal);
    const counts = new Map(categoryCounts(deals).map((c) => [c.category, c.count]));
    const lines = ["📚 <b>CATEGORIES</b>", ""];
    for (const c of CATEGORIES) lines.push(`${c} — ${counts.get(c) ?? 0}`);
    lines.push("", "<i>Use: /best rpg, /best horror, /best story …</i>");
    return { text: lines.join("\n") };
  }

  if (cmd === "/settings") return settingsReply(prefs, region);

  return { text: "Unknown command. Try /help" };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function settingsReply(prefs: Preferences, region: RegionConfig): Reply {
  return {
    text: [
      "⚙️ <b>SETTINGS</b>",
      "",
      `🌍 Region: ${prefs.region} (${region.currency})`,
      `🎯 Minimum deal score: ${prefs.minimumDealScore}`,
      `🏆 Daily deals count: ${prefs.dailyDealsCount}`,
      `💵 Show TND prices: ${prefs.displayTND ? "ON" : "OFF"}`,
      "",
      "<i>Toggle notifications and switch region below. Edit config/preferences.json for thresholds.</i>",
    ].join("\n"),
    keyboard: fmt.settingsKeyboard(prefs),
  };
}

async function wishlistReply(prefs: Preferences, region: RegionConfig): Promise<Reply> {
  const entries = loadWishlist();
  if (!entries.length)
    return { text: "🎮 Your wishlist is empty.\nAdd a game: /add Red Dead Redemption 2" };

  const history = loadPriceHistory();
  const deals = await scoredDeals(prefs).catch(() => [] as Scored[]);
  const bySlug = new Map(deals.map((d) => [slugify(d.deal.title), d]));
  const byId = new Map(deals.map((d) => [d.deal.id, d]));

  const rows = entries.map((entry, i) => {
    const live =
      bySlug.get(entry.gameId) ??
      (entry.url ? byId.get(entry.url.split("/").pop()?.split("?")[0] ?? "") : undefined);
    return {
      entry,
      stats: historyStats(entry.gameId, history),
      current: live?.deal.currentPrice,
      original: live?.deal.originalPrice,
      index: i,
    };
  });

  const shown = rows.slice(0, 8);
  const keyboard: InlineKeyboard = {
    inline_keyboard: shown.flatMap(
      (r) => fmt.wishlistItemKeyboard(r.entry, r.index).inline_keyboard,
    ),
  };
  if (rows.length > 8)
    keyboard.inline_keyboard.push([
      { text: `… and ${rows.length - 8} more — use /price or /history`, callback_data: "noop" },
    ]);

  return {
    text: fmt.wishlistViewMessage(
      rows.map(({ entry, stats, current, original }) => ({ entry, stats, current, original })),
      region,
    ),
    keyboard,
  };
}

export async function handleCallback(data: string): Promise<Reply> {
  const prefs = loadPreferences();
  const region = getRegion(prefs.region);
  const [action, a, b] = data.split(":");

  if (action === "noop") return { text: "✅" };

  if (action === "wadd") {
    const pending = takePending(a ?? "");
    if (!pending) return { text: "⏰ That add expired — send /add again." };
    const gameId = slugify(pending.title);
    const res = addToWishlist({
      gameId,
      title: pending.title,
      targetPrice: pending.targetPrice ?? (pending.free ? 0 : pending.currentPrice),
      url: pending.url,
    });
    if (!res.added) return { text: `ℹ️ ${res.reason}\nSee /wishlist.` };
    const entry = findWishlistEntry(gameId).entry!;
    return {
      text: `✅ <b>${esc(entry.title)}</b> added to your wishlist.\n🎯 Target: ${fmt.money(entry.targetPrice, region)}`,
      keyboard: fmt.wishlistItemKeyboard(entry, 0),
    };
  }

  if (action === "wcan") {
    const pending = takePending(a ?? "");
    return { text: pending ? `❌ Cancelled: <b>${esc(pending.title)}</b>.` : "Nothing to cancel." };
  }

  if (action === "wdel") {
    const { entry } = findWishlistEntry(a ?? "");
    if (!entry) return { text: "Not on your wishlist anymore." };
    removeFromWishlist(entry.gameId);
    return { text: `🗑 Removed <b>${esc(entry.title)}</b>.`, keyboard: undefined };
  }

  if (action === "wtgtq") {
    const { entry } = findWishlistEntry(a ?? "");
    if (!entry) return { text: "Not on your wishlist — /add it first, then set an alert." };
    return {
      text: `🔔 Alert for <b>${esc(entry.title)}</b> — pick a target:`,
      keyboard: fmt.targetKeyboard(entry.gameId),
    };
  }

  if (action === "wtgt") {
    const gameId = a ?? "";
    const price = Number(b);
    if (!Number.isFinite(price)) return { text: "Bad target." };
    let { entry } = findWishlistEntry(gameId);
    if (!entry) {
      const deal = (await scoredDeals(prefs).catch(() => [] as Scored[])).find(
        (d) => slugify(d.deal.title) === gameId,
      );
      if (!deal)
        return {
          text: `Not on your wishlist — add it first:\n/add ${esc(titleize(gameId))}`,
        };
      addToWishlist({
        gameId,
        title: deal.deal.title,
        targetPrice: price,
        url: deal.deal.url,
      });
      entry = findWishlistEntry(gameId).entry!;
    } else {
      entry = setTargetPrice(entry.gameId, price) ?? entry;
    }
    return {
      text: `🔔 Target for <b>${esc(entry.title)}</b> set to ${fmt.money(price, region)}.`,
      keyboard: fmt.wishlistItemKeyboard(entry, 0),
    };
  }

  if (action === "whis") {
    const gameId = a ?? "";
    const { entry } = findWishlistEntry(gameId);
    const key = entry?.gameId ?? findHistoryKey(gameId) ?? gameId;
    const stats = historyStats(key, loadPriceHistory());
    const title =
      entry?.title ??
      (await scoredDeals(prefs).catch(() => [] as Scored[])).find(
        (d) => slugify(d.deal.title) === gameId,
      )?.deal.title ??
      titleize(gameId);
    if (!stats.count)
      return {
        text: `📊 No recorded prices yet for <b>${esc(title)}</b> — they appear after the next check run.`,
      };
    return { text: fmt.priceHistoryMessage(title, stats, region, prefs) };
  }

  if (action === "st") {
    const key = a as keyof Preferences["notifications"];
    if (!(key in prefs.notifications)) return { text: "Unknown setting." };
    prefs.notifications[key] = !prefs.notifications[key];
    savePreferences(prefs);
    return settingsReply(prefs, region);
  }

  if (action === "sreg") {
    try {
      const next = getRegion(a ?? "");
      prefs.region = next.code;
      prefs.currency = next.currency;
      savePreferences(prefs);
      return settingsReply(prefs, getRegion(prefs.region));
    } catch (e) {
      return { text: (e as Error).message };
    }
  }

  return { text: "⏰ That button expired — send the command again." };
}
