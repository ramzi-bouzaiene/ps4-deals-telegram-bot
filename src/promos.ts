import fs from "fs";
import { notify, esc } from "./telegram";
import { fetchWithRetry } from "./http";
import { PSN_HEADERS, gqlOp } from "./psn";

export const PROMOS_FILE = "docs/promos.json";

// getExperience persisted query — tied to store web app 0.114.0; if it rotates,
// re-capture with scripts/capture-gql.js (see README).
const EXPERIENCE_HASH = "b5078800ed1bdebee9800979f9306abeadc5169030263f7095fe573b12e52270";
const EXPERIENCE_CLIENT = "b6de8d4d-bf9b-11ee-ad2a-aea73dc1ea43";
const ALIASES = ["latest", "deals"];
const ERROR_COOLDOWN_MS = 24 * 3600 * 1000;

export type PromoItem = { t: string; title: string; link: string; type: "store" | "rss" };
export type PromosState = { seen: string[]; items: PromoItem[]; lastError?: string };

export function loadPromosState(): PromosState {
  try {
    const v = JSON.parse(fs.readFileSync(PROMOS_FILE, "utf8"));
    return {
      seen: Array.isArray(v.seen) ? v.seen : [],
      items: Array.isArray(v.items) ? v.items : [],
      lastError: typeof v.lastError === "string" ? v.lastError : undefined,
    };
  } catch {
    return { seen: [], items: [] };
  }
}

export function savePromosState(s: PromosState) {
  fs.mkdirSync("docs", { recursive: true });
  fs.writeFileSync(PROMOS_FILE, JSON.stringify(s, null, 2) + "\n");
}

function linkFor(l: any): string {
  if (!l || typeof l !== "object") return "";
  if (l.type === "EMS_CATEGORY" && typeof l.target === "string")
    return `https://store.playstation.com/fr-fr/category/${l.target}/1`;
  if (typeof l.target === "string" && /^https?:\/\//.test(l.target)) return l.target;
  return "";
}

function collectComponents(node: any, out: Map<string, { title: string; link: string }>): void {
  if (Array.isArray(node)) {
    node.forEach((n) => collectComponents(n, out));
    return;
  }
  if (!node || typeof node !== "object") return;
  const kind = node.__typename;
  if (
    kind === "EMSImageComponent" ||
    kind === "EMSStrandComponent" ||
    kind === "EMSTextComponent"
  ) {
    const title =
      (typeof node.altText === "string" && node.altText) ||
      (typeof node.title === "string" && node.title) ||
      (typeof node.text === "string" && node.text) ||
      "";
    const link = linkFor(node.link) || linkFor(node.viewAllLink);
    if (node.id && title && link) out.set(node.id, { title, link });
  }
  for (const v of Object.values(node)) {
    if (v && typeof v === "object") collectComponents(v, out);
  }
}

export async function checkPromos() {
  const state = loadPromosState();
  const found = new Map<string, { title: string; link: string }>();

  try {
    for (const alias of ALIASES) {
      const url = gqlOp("getExperience", { clientId: EXPERIENCE_CLIENT, alias }, EXPERIENCE_HASH);
      const res = await fetchWithRetry(url, { headers: PSN_HEADERS });
      if (!res.ok) throw new Error(`getExperience(${alias}) HTTP ${res.status}`);
      collectComponents(await res.json(), found);
    }
  } catch (e) {
    const msg = (e as Error).message;
    const last = state.lastError ? Date.parse(state.lastError) : 0;
    const shouldAlert = !state.lastError || Date.now() - last >= ERROR_COOLDOWN_MS;
    console.error("Promo check failed:", msg);
    if (shouldAlert) {
      state.lastError = new Date().toISOString();
      savePromosState(state);
      await notify(
        `⚠️ <b>PS Store promo check failed</b>\n${esc(msg)}\n` +
          `The GraphQL hash may have rotated — see README “If promotions stop updating”.`,
      );
    }
    return;
  }

  const baseline = state.seen.length === 0;
  const added: { title: string; link: string }[] = [];
  for (const [id, comp] of found) {
    if (state.seen.includes(id)) continue;
    state.seen.push(id);
    if (!baseline) added.push(comp);
  }
  delete state.lastError;
  if (!baseline && added.length) {
    for (const c of added) {
      state.items.unshift({
        t: new Date().toISOString(),
        title: c.title,
        link: c.link,
        type: "store",
      });
    }
    state.items = state.items.slice(0, 50);
  }
  savePromosState(state);
  console.log(
    baseline
      ? `Promo baseline recorded (${found.size} banners).`
      : added.length
        ? `${added.length} new promotion(s).`
        : "No new promotions.",
  );

  if (added.length) {
    const body = added.map((c) => `📣 <b>${esc(c.title)}</b>\n${c.link}`).join("\n\n");
    await notify(
      `📣 <b>${added.length} new PS Store promotion${added.length > 1 ? "s" : ""}</b>\n\n${body}`,
    );
  }
}

if (require.main === module) {
  checkPromos().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
