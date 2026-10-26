export const SITE = "https://preeminentstore.com";

export const BRANDS = {
  pokemon: "The Pokémon Company",
  magic: "Wizards of the Coast",
  fab: "Legend Story Studios",
  weiss: "Bushiroad",
  riftbound: "Riot Games",
  onepiece: "Bandai",
  gundam: "Bandai",
};

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Public catalog as last pushed by the PC; the deployed catalog.json is only a fallback. */
export async function loadCatalog(env, request) {
  const fromKv = await env.STORE.get("catalog", { type: "json", cacheTtl: 300 });
  if (fromKv) return fromKv;
  const res = await env.ASSETS.fetch(new URL("/catalog.json", request.url));
  return res.ok ? res.json() : { items: [], shipping: {} };
}

export const productUrl = (item) => `${SITE}/p/${encodeURIComponent(item.id)}`;
export const imageUrl = (item) => (item.image ? `${SITE}/${item.image}` : `${SITE}/brand/logo.jpg`);

/** Shipping when the item is bought on its own. */
export const shipFor = (item, shipping = {}) =>
  item.ship === "single" ? shipping.single : item.ship === "deck" && item.shipCost > 0 ? item.shipCost : shipping.standard;

export const STORE_NAME = "The PreEminent Store";

/** Custom decks are our own builds, so the game publisher must never be named as their brand. */
export const brandFor = (item) => (item.deck ? STORE_NAME : BRANDS[item.game] || "");

export function describe(item, shipping = {}) {
  const what = item.deck
    ? `Custom deck assembled by ${STORE_NAME} from cards opened from booster packs. Not factory sealed and not an official product of ${BRANDS[item.game] || "the game's publisher"}`
    : item.ship === "single"
      ? `${item.condition || "Near Mint"} single card`
      : "Factory sealed";
  const ship = shipFor(item, shipping);
  return [item.set, what, ship ? `$${Number(ship).toFixed(2)} flat US shipping` : "Ships within the US"].filter(Boolean).join(" · ");
}

/** Google's "new" means unopened original packaging: custom decks are built from opened product, so they're used. */
export const googleCondition = (item) => (item.deck ? "used" : !item.condition || /near mint|unopened/i.test(item.condition) ? "new" : "used");

/**
 * Custom-built decks stay on the website for direct shoppers but must not appear in Google Shopping /
 * Merchant Center surfaces. Google previously suspended us for Counterfeit after those listings were
 * in the feed (Oct 16, 2026); keep them out of the feed, sitemap, and Product structured data.
 */
export function isCustomDeckItem(item) {
  if (!item) return false;
  if (item.deck) return true;
  if (/^custom\s*deck$/i.test(String(item.type || ""))) return true;
  const blob = `${item.title || ""} ${item.name || ""} ${item.type || ""}`;
  if (/\b(custom\s*built|premade\s*deck|unofficial)\b/i.test(blob)) return true;
  if (/\b(replica|knock[\s-]?off|counterfeit|proxy\s*card|fake\s*card)\b/i.test(blob)) return true;
  return false;
}

/** True for items allowed in https://preeminentstore.com/feed.xml (Merchant Center). */
export function allowInMerchantFeed(item) {
  return Boolean(item?.image) && !isCustomDeckItem(item);
}
