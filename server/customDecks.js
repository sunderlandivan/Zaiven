import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { readWebOrders } from "./webOrders.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
// Custom decks the owner builds from openings. They are also listed on eBay, so they never live in the Sheet.
export const DECKS_PATH = path.join(ROOT, "data", "custom-decks.json");
const QUEUE_PATH = path.join(ROOT, "data", "sheet-sync-queue.json");

const GAME_LABEL = { pokemon: "Pokémon", magic: "Magic", fab: "Flesh and Blood" };

export const isDeckId = (id) => /^deck-/.test(String(id || ""));

function readJson(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return fallback;
  }
}

const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** eBay sale emails can cut the listing title short; match when one title starts the other. */
export function ebayTitleMatches(saleTitle, listingTitle) {
  const a = norm(saleTitle);
  const b = norm(listingTitle);
  if (!a || !b) return false;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 25 && long.startsWith(short);
}

/**
 * Lowers deck quantities for sales the file hasn't counted yet:
 * website orders once the Sheet sync has logged them (until then checkout's own unsynced count holds the stock),
 * and eBay sale emails since the decks were captured from eBay. Returns how many sales were newly counted.
 */
export function applyDeckSales(file, { orders = [], events = [] } = {}) {
  const decks = new Map((file.decks || []).map((d) => [d.id, d]));
  file.websiteSales ||= [];
  file.ebaySales ||= [];
  const seenWeb = new Set(file.websiteSales.map((s) => s.orderId));
  const seenEbay = new Set(file.ebaySales.map((s) => s.eventId));
  const applied = new Set(events.filter((e) => e.status === "applied").map((e) => e.id));
  const at = new Date().toISOString();
  let counted = 0;
  for (const o of orders) {
    if (seenWeb.has(o.id) || !applied.has(`web:${o.id}`)) continue;
    const lines = (o.lines || []).filter((l) => decks.has(l.id));
    if (!lines.length) continue;
    for (const l of lines) decks.get(l.id).qty = Math.max(0, decks.get(l.id).qty - l.qty);
    file.websiteSales.push({ orderId: o.id, at, lines: lines.map((l) => ({ id: l.id, qty: l.qty })) });
    counted += 1;
  }
  const since = file.capturedFromEbayAt || "";
  for (const e of events) {
    if (e.source !== "ebay" || e.status === "ignored" || seenEbay.has(e.id) || String(e.createdAt || "") < since) continue;
    const lines = [];
    for (const line of e.lines || []) {
      const deck = [...decks.values()].find((d) => ebayTitleMatches(line.description, d.ebay?.title));
      if (deck) lines.push({ id: deck.id, qty: Number(line.qty) || 1 });
    }
    if (!lines.length) continue;
    for (const l of lines) decks.get(l.id).qty = Math.max(0, decks.get(l.id).qty - l.qty);
    file.ebaySales.push({ eventId: e.id, at, lines });
    counted += 1;
  }
  return counted;
}

/** Owner-set unit cost for a deck sale, found by website line id or eBay listing title; undefined when no deck matches. */
export function deckCostFor({ id, title } = {}) {
  const decks = readJson(DECKS_PATH, {}).decks || [];
  const deck = id ? decks.find((d) => d.id === id) : decks.find((d) => ebayTitleMatches(title, d.ebay?.title));
  return deck && Number(deck.cost) > 0 ? Number(deck.cost) : undefined;
}

/** Catalog items for the website's Custom Decks section. The price is the owner's eBay price, used as-is. */
export function buildDeckItems({ dryRun = false } = {}) {
  const file = readJson(DECKS_PATH, null);
  if (!file) return [];
  if (!dryRun) {
    const counted = applyDeckSales(file, { orders: readWebOrders(), events: readJson(QUEUE_PATH, {}).events || [] });
    if (counted) fs.writeFileSync(DECKS_PATH, JSON.stringify(file, null, 2) + "\n");
  }
  return (file.decks || [])
    .filter((d) => d.price > 0)
    .map((d) => ({
      id: d.id,
      title: `${GAME_LABEL[d.game] || ""} ${d.name}`.trim(),
      name: d.name,
      set: d.format || "",
      code: "",
      game: d.game,
      type: "Custom Deck",
      // Deck-only orders pay the deck's own rate (matches its eBay listing); any sealed item in the cart means the standard rate.
      ship: "deck",
      shipCost: Number(d.shipping) > 0 ? Number(d.shipping) : null,
      condition: "Near Mint · built by us",
      price: d.price,
      qty: Math.max(0, Number(d.qty) || 0),
      addedRow: 0,
      image: d.images?.[0] || null,
      images: d.images || [],
      ...(d.includes ? { includes: d.includes } : {}),
      deck: true,
      locked: true,
    }));
}
