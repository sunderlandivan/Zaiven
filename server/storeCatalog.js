import fs from "fs";
import path from "path";
import axios from "axios";
import { fileURLToPath } from "url";
import { readStockRows, getSheetSyncSettings } from "./sheetLedger.js";
import { productDetails, productIdFromUrl, searchProducts } from "./tcgplayerCatalog.js";
import { getTcgplayerListings } from "./tcgplayerPriceImport.js";
import { buildDeckItems } from "./customDecks.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
export const STORE_DIR = path.join(ROOT, "storefront");
const IMG_DIR = path.join(STORE_DIR, "img");
export const CATALOG_PATH = path.join(STORE_DIR, "catalog.json");
export const STOCK_PATH = path.join(ROOT, "data", "store-stock.json");
const STORE_SETTINGS_PATH = path.join(ROOT, "data", "store-settings.json");
const PRICE_REVIEW_PATH = path.join(ROOT, "data", "store-price-review.json");
export const COST_FLOORS_PATH = path.join(ROOT, "data", "store-cost-floors.json");
// Catalog id -> date first seen in the catalog (decides the new-item profit minimum).
export const FIRST_SEEN_PATH = path.join(ROOT, "data", "store-first-seen.json");

const DEFAULT_STORE_SETTINGS = {
  contactEmail: "",
  // Store item id -> price you've decided on; beats the TCGplayer export and the profit floor.
  priceOverrides: {},
  // Legacy floor only (floorModel "legacy").
  pricing: { feeRate: 0.15, minProfitPct: 0.1 },
  // "legacy" = sheet formula on average cost; "explicit" = owner's rule (highest cost, real PayPal/tax/shipping math).
  floorModel: "legacy",
  floor: {
    paypalPct: 0.0349,
    paypalFixed: 0.49,
    minProfitExisting: 0.15,
    // Items first seen after `reviewedOn` (the owner's full price review).
    minProfitNew: 0.1,
    reviewedOn: "2026-10-09",
    labels: { small: 6.11, etb: 9.47, box: 9.96, case: 23.05 },
  },
  // Owner-reviewed prices: always the website price. Floors only warn (price review) and never move them.
  lockedPrices: {},
  shipping: {
    standard: 10.99,
    single: 1.27,
    // Order subtotal that unlocks free standard shipping; null = no promo running.
    freeOver: null,
    promoText: "",
  },
};

export function getStoreSettings() {
  let saved = {};
  try {
    saved = JSON.parse(fs.readFileSync(STORE_SETTINGS_PATH, "utf8"));
  } catch {
    fs.writeFileSync(STORE_SETTINGS_PATH, JSON.stringify(DEFAULT_STORE_SETTINGS, null, 2));
  }
  return {
    ...DEFAULT_STORE_SETTINGS,
    ...saved,
    shipping: { ...DEFAULT_STORE_SETTINGS.shipping, ...saved.shipping },
    floor: { ...DEFAULT_STORE_SETTINGS.floor, ...saved.floor, labels: { ...DEFAULT_STORE_SETTINGS.floor.labels, ...saved.floor?.labels } },
  };
}

function shipClass(row) {
  return /\b(single|card)s?\b/i.test(row.type) || /^(sgl|single|card)$/i.test(row.code) ? "single" : "standard";
}

const GAMES = [
  { key: "pokemon", label: "Pokémon", slug: /^poke/i, words: /pok[eé]mon|elite trainer|booster bundle/i },
  { key: "magic", label: "Magic: The Gathering", slug: /^magi/i, words: /play booster|collector booster|commander|jumpstart/i },
  { key: "fab", label: "Flesh and Blood", slug: /^fles/i, words: /flesh and blood|rathe|mistveil/i },
  { key: "weiss", label: "Weiss Schwarz", slug: /^weis/i, words: /weiss/i },
  { key: "riftbound", label: "Riftbound", slug: /^rift/i, words: /riftbound/i },
  { key: "onepiece", label: "One Piece", slug: /^one-/i, words: /one piece/i },
  { key: "gundam", label: "Gundam", slug: /^gund/i, words: /gundam/i },
];

function gameFor(row) {
  const slug = String(row.link || "").match(/tcgplayer\.com\/product\/\d+\/([a-z0-9-]+)/i)?.[1] || "";
  const g = GAMES.find((x) => slug && x.slug.test(slug)) || GAMES.find((x) => x.words.test(row.itemId));
  if (g) return g.key;
  return /sleeve|deck ?box|playmat|binder|toploader/i.test(row.itemId) || /acc/i.test(row.code) ? "accessories" : "other";
}

/** "Product - Set Name (CODE)" -> { name, set, code } */
function splitTitle(itemId) {
  const m = String(itemId).match(/^(.*) - (.+?)(?: \(([^)]+)\))?$/);
  if (!m || !m[2]) return { name: itemId, set: "", code: "" };
  return { name: m[1].trim(), set: m[2].trim(), code: (m[3] || "").trim() };
}

function slugify(s) {
  return String(s).toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

async function ensureImage(productId, dryRun = false) {
  if (!productId) return null;
  const file = `${productId}.jpg`;
  const dest = path.join(IMG_DIR, file);
  if (fs.existsSync(dest)) return `img/${file}`;
  if (dryRun) return null;
  try {
    const { data } = await axios.get(`https://product-images.tcgplayer.com/fit-in/600x600/${productId}.jpg`, {
      responseType: "arraybuffer",
      timeout: 20000,
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    fs.mkdirSync(IMG_DIR, { recursive: true });
    fs.writeFileSync(dest, Buffer.from(data));
    return `img/${file}`;
  } catch {
    return null;
  }
}

const LOW_STOCK_AT = 3;

const SYNC_QUEUE_PATH = path.join(ROOT, "data", "sheet-sync-queue.json");
const SINGLE_IDS_PATH = path.join(ROOT, "data", "tcgplayer-single-ids.json");
const LINE_GAME = [
  [/pok/i, "pokemon"],
  [/magic/i, "magic"],
  [/flesh/i, "fab"],
  [/weiss/i, "weiss"],
  [/riftbound/i, "riftbound"],
  [/one piece/i, "onepiece"],
  [/gundam/i, "gundam"],
];

/** The seller export only carries per-condition SKU ids; images need the product id, found once via search and remembered. */
async function singleProductId(l, known) {
  const key = `${l.line}|${l.set}|${l.name}|${l.number}`;
  if (key in known) return known[key];
  let id = null;
  try {
    const results = await searchProducts(`${l.name} ${l.set}`, 24);
    const same = (a, b) => String(a || "").toLowerCase() === String(b || "").toLowerCase();
    const hit =
      results.find((r) => same(r.productName, l.name) && same(r.setName, l.set) && (!l.number || same(r.customAttributes?.number, l.number))) ||
      results.find((r) => same(r.productName, l.name) && same(r.setName, l.set));
    id = hit ? hit.productId : null;
  } catch {
    return null;
  }
  known[key] = id;
  return id;
}

/**
 * Singles sold (per the Gmail sync) after the last TCGplayer export import, keyed by lowercase card name.
 * Sale emails name variants like "Restless Steed (Marvel)", so the trailing "(...)" groups are also counted under the base name.
 */
function singlesSoldSince(importedAt) {
  const sold = new Map();
  if (!importedAt) return sold;
  let events = [];
  try {
    events = JSON.parse(fs.readFileSync(SYNC_QUEUE_PATH, "utf8")).events || [];
  } catch {
    return sold;
  }
  for (const e of events) {
    if (e.kind !== "sale" || e.status !== "applied" || (e.createdAt || "") < importedAt) continue;
    for (const line of e.lines || []) {
      if (line.plan?.action !== "single") continue;
      const full = String(line.description || "").toLowerCase().trim();
      const base = full.replace(/(\s*\([^)]*\))+$/, "").trim();
      // Sale emails sometimes drop trailing "?" / "!" from the card name.
      const loose = base.replace(/[?!]+$/g, "").trim();
      for (const k of new Set([full, base, loose].filter(Boolean))) {
        sold.set(k, (sold.get(k) || 0) + (Number(line.qty) || 1));
      }
    }
  }
  return sold;
}

/** Cards listed on TCGplayer: the store sells the same stock at the same Marketplace price. */
async function buildSingles({ dryRun = false } = {}) {
  let known = {};
  try {
    known = JSON.parse(fs.readFileSync(SINGLE_IDS_PATH, "utf8"));
  } catch {
    /* first run */
  }
  const { importedAt, listings } = getTcgplayerListings();
  const sold = singlesSoldSince(importedAt);
  const out = [];
  for (const l of listings) {
    if (l.condition === "Unopened" || l.qty <= 0 || l.price <= 0) continue;
    const key = l.name.toLowerCase();
    const loose = key.replace(/[?!]+$/g, "").trim();
    const take = Math.min(sold.get(key) || sold.get(loose) || 0, l.qty);
    if (take) {
      const from = sold.has(key) ? key : loose;
      sold.set(from, (sold.get(from) || 0) - take);
    }
    if (l.qty - take <= 0) continue;
    const productId = await singleProductId(l, known);
    out.push({
      id: `s${l.skuId}`,
      title: `${l.name} - ${l.set} (${l.condition})`,
      name: l.name,
      set: l.set,
      code: l.number ? `#${l.number}` : "",
      game: LINE_GAME.find(([re]) => re.test(l.line))?.[1] || "other",
      type: "Single",
      ship: "single",
      condition: l.condition,
      rarity: l.rarity,
      price: l.price,
      qty: l.qty - take,
      addedRow: 0,
      image: await ensureImage(productId, dryRun),
    });
  }
  if (!dryRun) fs.writeFileSync(SINGLE_IDS_PATH, JSON.stringify(known, null, 2));
  return out;
}

/**
 * Legacy floor (floorModel "legacy"): the sheet's formula on the average cost,
 * fees = 15% of (price + shipping), profit = price - cost - fees.
 */
export function minPriceFor(cost, shipping, { feeRate, minProfitPct }) {
  if (!cost) return 0;
  return Math.ceil(((cost * (1 + minProfitPct) + feeRate * shipping) / (1 - feeRate)) * 100) / 100;
}

/** Label-size bucket for the shipping estimate (medians of the owner's single-item USPS labels). */
export function labelKind(title, type = "") {
  if (/booster box case/i.test(title)) return "case";
  if (/booster box|\bdisplay\b/i.test(title)) return "box";
  if (/^(pack|accessories)$/i.test(type) || /booster bundle|blister|\bpacks?\b|starter kit|sleeves?|deck ?box/i.test(title)) return "small";
  return "etb";
}

/** Highest CA rate the store can charge (base + every district), for the worst-case PayPal fee. */
export function worstCaseTaxRate(salesTax) {
  if (!salesTax?.enabled) return 0;
  return Number(salesTax.baseRate || 0) + (salesTax.districts || []).reduce((s, d) => s + Number(d.rate || 0), 0);
}

/**
 * Owner's floor (floorModel "explicit"): the lowest price P where
 * P − PayPal fee − net shipping − cost ≥ minProfit × cost, with
 * PayPal fee = paypalPct × (P + shipping charged + P × worst-case tax) + paypalFixed and
 * net shipping = max(0, label estimate − shipping charged). Tax is pass-through, never income.
 */
export function explicitFloor({ cost, minProfit, shipCharged, label, taxRate, paypalPct, paypalFixed }) {
  if (!cost) return 0;
  const netShip = Math.max(0, label - shipCharged);
  return Math.ceil(((cost * (1 + minProfit) + netShip + paypalPct * shipCharged + paypalFixed) / (1 - paypalPct * (1 + taxRate))) * 100 - 1e-9) / 100;
}

/** Profit floor for a catalog item under the configured model. Explicit uses the highest unit cost and 15% / 10% (new). */
export function floorFor(it, settings, { isNew = false } = {}) {
  if (settings.floorModel !== "explicit") return minPriceFor(it.sheet.cost, it.sheet.shipping, settings.pricing);
  const f = settings.floor;
  return explicitFloor({
    cost: it.sheet.maxCost,
    minProfit: isNew ? f.minProfitNew : f.minProfitExisting,
    shipCharged: it.ship === "single" ? settings.shipping.single : settings.shipping.standard,
    label: f.labels[labelKind(it.title, it.type)],
    taxRate: worstCaseTaxRate(settings.salesTax),
    paypalPct: f.paypalPct,
    paypalFixed: f.paypalFixed,
  });
}

/**
 * The public catalog lists only items the website can sell right now (`stockItems` = exact stock after unsynced web
 * orders). Sold-out items drop off the site, feed and sitemap, and come back when restocked. Exact stock stays private.
 */
export function inStockCatalog(catalog, stockItems) {
  const items = (catalog.items || []).filter((i) => stockItems[i.id]?.q > 0);
  return { ...catalog, count: items.length, items };
}

/** An owner-locked price is the price, whatever the floor says; the floor only flags it. Null when not locked. */
export function lockedPriceFor(lockedPrice, floor) {
  const price = Number(lockedPrice);
  return price > 0 ? { price, belowFloor: floor > price } : null;
}

// Local (Pacific) date: the review date is a business date, and UTC rolls over at 5 PM here.
const today = () => new Date().toLocaleDateString("en-CA");

/**
 * Public catalog: only rows with Qty > 0 and a retail price. Cost, status and sheet details never leave the PC.
 * Rows for the same product across tabs merge; the purchase tab's price wins since it is the newest.
 * `dryRun` writes nothing and also returns the per-item cost/floor detail; `overrides` (dry run only) replaces
 * settings such as floorModel or lockedPrices, for price audits.
 */
export async function buildStoreCatalog({ dryRun = false, overrides = {} } = {}) {
  const { purchaseTab } = getSheetSyncSettings();
  const settings = { ...getStoreSettings(), ...(dryRun ? overrides : {}) };
  const locked = settings.lockedPrices || {};
  let firstSeen = {};
  try {
    firstSeen = JSON.parse(fs.readFileSync(FIRST_SEEN_PATH, "utf8"));
  } catch {
    /* first run */
  }
  // Availability is the Qty column only; the Sheet's Status text ("Sold out", "In stock") isn't maintained.
  const rows = (await readStockRows()).filter((r) => r.qty > 0 && r.lastRetail > 0);
  rows.sort((a, b) => (a.tab === purchaseTab ? 0 : 1) - (b.tab === purchaseTab ? 0 : 1));

  const byKey = new Map();
  for (const r of rows) {
    const productId = productIdFromUrl(r.link);
    const key = productId ? `p${productId}` : `n:${r.itemId.toLowerCase()}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.sheet.cost = (existing.sheet.cost * existing.qty + r.cost * r.qty) / (existing.qty + r.qty);
      existing.sheet.maxCost = Math.max(existing.sheet.maxCost, r.cost || 0);
      existing.qty += r.qty;
      existing.sheet.rows.push(`${r.tab} row ${r.rowNumber}`);
      continue;
    }
    const { name, set, code } = splitTitle(r.itemId);
    byKey.set(key, {
      id: productId ? String(productId) : slugify(r.itemId),
      productId,
      title: r.itemId,
      name,
      set,
      code,
      game: gameFor(r),
      type: r.type || "",
      ship: shipClass(r),
      price: Math.round(r.lastRetail * 100) / 100,
      qty: r.qty,
      addedRow: r.tab === purchaseTab ? r.rowNumber : 0,
      sheet: { price: r.lastRetail, cost: r.cost, maxCost: r.cost || 0, shipping: r.calcShipping || settings.shipping.standard, rows: [`${r.tab} row ${r.rowNumber}`] },
    });
  }

  const items = [...byKey.values()];
  const review = [];
  const listings = getTcgplayerListings().listings.filter((x) => x.condition === "Unopened" && x.price > 0);
  const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
  for (const it of items) {
    it.image = await ensureImage(it.productId, dryRun);
    firstSeen[it.id] ||= today();
    const explicit = settings.floorModel === "explicit";
    const base = { title: it.title, rows: it.sheet.rows, sheetPrice: it.sheet.price, cost: explicit ? it.sheet.maxCost : it.sheet.cost };
    const floor = floorFor(it, settings, { isNew: firstSeen[it.id] > settings.floor.reviewedOn });
    it.floor = floor;
    const lock = lockedPriceFor(locked[it.id], floor);
    if (lock) {
      it.price = lock.price;
      it.locked = true;
      if (lock.belowFloor) {
        review.push({ ...base, reason: "locked_below_floor", lockedPrice: lock.price, minPrice: floor });
        if (!dryRun) console.warn(`[store] owner-locked price $${lock.price} for ${it.title} is below its floor $${floor}; price kept.`);
      }
      continue;
    }
    let details = null;
    if (it.productId) {
      try {
        details = await productDetails(it.productId);
      } catch {
        /* catalog lookup is best-effort */
      }
    }
    // Your own TCGplayer listing price (the export's "TCG Marketplace Price", not TCGplayer's market price) is the retail price whenever the product is listed there.
    const override = Number(settings.priceOverrides?.[it.id]);
    if (override > 0) {
      it.price = Math.max(override, floor);
      if (floor > override) review.push({ ...base, reason: "override_below_min_profit", override, minPrice: floor });
      continue;
    }
    const listing =
      details &&
      (listings.find((x) => norm(x.name) === norm(details.productName) && norm(x.set) === norm(details.setName)) ||
        listings.find((x) => norm(x.name) === norm(details.productName)));
    if (listing) {
      it.price = Math.max(listing.price, floor);
      if (floor > listing.price) review.push({ ...base, reason: "tcgplayer_below_min_profit", tcgplayerPrice: listing.price, minPrice: floor });
      if (Math.abs(listing.price - it.sheet.price) >= 0.01) review.push({ ...base, reason: "sheet_differs_from_tcgplayer", tcgplayerPrice: listing.price });
      continue;
    }
    // Not listed on TCGplayer: the sheet's Last Retail, never below the floor.
    it.price = Math.max(it.price, floor);
    review.push({ ...base, reason: "not_on_tcgplayer", websitePrice: it.price });
    if (floor > it.sheet.price) review.push({ ...base, reason: "sheet_below_min_profit", minPrice: floor });
  }
  items.push(...(await buildSingles({ dryRun })));
  items.push(...buildDeckItems({ dryRun }));
  // Every price ends in .99, always rounding up so nothing drops below its floor. Locked prices are used as-is.
  for (const it of items) if (!it.locked) it.price = Math.round((Math.floor(it.price + 1e-9) + 0.99) * 100) / 100;

  const catalog = {
    updatedAt: new Date().toISOString(),
    count: items.length,
    shipping: settings.shipping,
    contactEmail: settings.contactEmail,
    // Exact stock never leaves the PC: buyers only see "Low stock"; checkout verifies quantities server-side.
    // "Low stock" follows the real count, not the limited-items display cap, so it's never a false scarcity claim.
    items: items.map(({ productId, sheet, qty, floor, locked: _locked, ...rest }) => ({ ...rest, low: qty <= LOW_STOCK_AT })),
  };
  // Private twin of the catalog for checkout: exact quantities and the prices the server charges.
  const stock = {
    updatedAt: catalog.updatedAt,
    shipping: settings.shipping,
    items: Object.fromEntries(items.map((i) => [i.id, { t: i.title, n: i.name, p: i.price, q: i.qty, s: i.ship, f: i.floor || 0, ...(i.shipCost ? { sh: i.shipCost } : {}) }])),
  };
  if (dryRun) {
    const detail = Object.fromEntries(
      items.filter((i) => i.sheet).map((i) => [i.id, { name: i.name, price: i.price, floor: i.floor, locked: Boolean(i.locked), isNew: firstSeen[i.id] > settings.floor.reviewedOn, avgCost: i.sheet.cost, maxCost: i.sheet.maxCost }])
    );
    return { catalog, stock, detail, review };
  }
  fs.writeFileSync(FIRST_SEEN_PATH, JSON.stringify(firstSeen, null, 2));
  fs.mkdirSync(STORE_DIR, { recursive: true });
  fs.writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2));
  fs.writeFileSync(STOCK_PATH, JSON.stringify(stock));
  fs.writeFileSync(PRICE_REVIEW_PATH, JSON.stringify({ updatedAt: catalog.updatedAt, items: review }, null, 2));
  // Pricing rule: the cost baseline is the highest unit cost among the item's rows. Kept off the pushed stock.
  const costFloors = Object.fromEntries(
    items
      .filter((i) => i.sheet)
      .map((i) => [i.id, { maxCost: i.sheet.maxCost, floor: floorFor(i, { ...settings, floorModel: "explicit" }, { isNew: firstSeen[i.id] > settings.floor.reviewedOn }) }])
  );
  fs.writeFileSync(COST_FLOORS_PATH, JSON.stringify({ updatedAt: catalog.updatedAt, items: costFloors }, null, 2));
  return catalog;
}

export function getStorePriceReview() {
  try {
    return JSON.parse(fs.readFileSync(PRICE_REVIEW_PATH, "utf8"));
  } catch {
    return { updatedAt: null, items: [] };
  }
}

let timer = null;
export function startStoreCatalogScheduler(intervalMinutes = 30) {
  if (timer) return;
  const run = () => buildStoreCatalog().catch((e) => console.warn("[store] catalog build failed:", e.message));
  setTimeout(run, 20_000);
  timer = setInterval(run, intervalMinutes * 60_000);
}
