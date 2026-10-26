import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { nanoid } from "nanoid";
import { getTcgplayerReferenceMarketForTreasure } from "./inventoryAgent.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const TREASURE_DB_PATH = path.join(DATA_DIR, "treasure-hunt-db.json");
const INVENTORY_DB_PATH = path.join(DATA_DIR, "inventory-db.json");
const SCAN_DELAY_MS = 95;
const DEFAULT_TREASURE_TAX_PCT = 8;
const DEFAULT_TREASURE_SHIPPING_USD = 10.99;

/** When scanning “all” inventory, never fetch more than this many rows in one run (override via TREASURE_SCAN_MAX_ITEMS_HARD_CAP). */
function getScanHardCap() {
  const n = Number(process.env.TREASURE_SCAN_MAX_ITEMS_HARD_CAP);
  if (Number.isFinite(n) && n >= 1) return Math.min(1_000_000, Math.floor(n));
  return 25_000;
}

/** null maxItems (or ≤0 / string "all") = scan every eligible row, up to hard cap. Positive = first N rows only. */
function resolveTreasureScanItemSlice(body = {}) {
  const eligible = readInventoryItems().filter(
    (it) => Number(it.quantity || 0) > 0 && Number(it.unitCost || 0) > 0
  );
  const eligibleCount = eligible.length;
  const hardCap = getScanHardCap();
  const raw = body?.maxItems;

  let firstN = null;
  if (raw !== undefined && raw !== null && String(raw).trim() !== "") {
    const s = String(raw).trim().toLowerCase();
    if (s !== "all") {
      const n = Number(raw);
      if (Number.isFinite(n) && n > 0) firstN = Math.min(hardCap, Math.floor(n));
    }
  }

  let items;
  if (firstN == null) {
    items = eligible.slice(0, hardCap);
  } else {
    items = eligible.slice(0, firstN);
  }

  return {
    items,
    inventoryEligible: eligibleCount,
    scanMaxItems: firstN,
    hardCap,
    scanTruncatedByHardCap: firstN == null && eligibleCount > hardCap,
  };
}

function migrateTreasureDb(raw) {
  const db = raw && typeof raw === "object" ? raw : {};
  if (!Array.isArray(db.deals)) db.deals = [];
  if (!db.scan || typeof db.scan !== "object") {
    db.scan = { id: null, at: null, findings: [], errors: [], meta: null };
  }
  if (!Array.isArray(db.scan.findings)) db.scan.findings = [];
  if (!Array.isArray(db.scan.errors)) db.scan.errors = [];
  if (!("lastViewedScanId" in db)) db.lastViewedScanId = null;
  return db;
}

function ensureTreasureDb() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(TREASURE_DB_PATH)) {
    const initial = migrateTreasureDb({ deals: [] });
    fs.writeFileSync(TREASURE_DB_PATH, JSON.stringify(initial, null, 2));
  }
}

function readTreasureDb() {
  ensureTreasureDb();
  return migrateTreasureDb(JSON.parse(fs.readFileSync(TREASURE_DB_PATH, "utf8")));
}

function writeTreasureDb(value) {
  ensureTreasureDb();
  fs.writeFileSync(TREASURE_DB_PATH, JSON.stringify(migrateTreasureDb(value), null, 2));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function readInventoryItems() {
  try {
    if (!fs.existsSync(INVENTORY_DB_PATH)) return [];
    const db = JSON.parse(fs.readFileSync(INVENTORY_DB_PATH, "utf8"));
    return Array.isArray(db.items) ? db.items : [];
  } catch {
    return [];
  }
}

function normalizeKey(s) {
  return String(s || "")
    .replace(/^\uFEFF/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokenSet(s) {
  const n = normalizeKey(s);
  return new Set(n.split(/\s+/).filter((w) => w.length > 1));
}

function matchScore(query, productName) {
  const a = tokenSet(query);
  const b = tokenSet(productName);
  if (!a.size || !b.size) return 0;
  let hit = 0;
  for (const t of a) {
    if (b.has(t)) hit += 1;
    else {
      for (const u of b) {
        if (u.includes(t) || t.includes(u)) {
          hit += 0.45;
          break;
        }
      }
    }
  }
  return hit / a.size;
}

/** Best-effort link to an inventory row from a pasted deal title. */
export function findBestInventoryMatch(productQuery) {
  const items = readInventoryItems();
  let best = null;
  let bestScore = 0;
  for (const item of items) {
    const name = item.productName || "";
    const sc = matchScore(productQuery, name);
    if (sc > bestScore) {
      bestScore = sc;
      best = item;
    }
  }
  if (!best || bestScore < 0.22) return { match: null, score: bestScore };
  return {
    match: {
      id: best.id,
      productName: best.productName,
      unitCost: Number(best.unitCost || 0),
      quantity: Number(best.quantity || 0),
    },
    score: bestScore,
  };
}

export function listTreasureInventorySkus() {
  return readInventoryItems().map((i) => ({
    id: i.id,
    productName: i.productName,
    unitCost: Number(i.unitCost || 0),
    quantity: Number(i.quantity || 0),
  }));
}

function enrichDeal(deal) {
  const items = readInventoryItems();
  let matched = null;
  if (deal.inventoryItemId) {
    const inv = items.find((i) => i.id === deal.inventoryItemId);
    if (inv) {
      matched = {
        id: inv.id,
        productName: inv.productName,
        unitCost: Number(inv.unitCost || 0),
        quantity: Number(inv.quantity || 0),
      };
    }
  }
  if (!matched && deal.productQuery) {
    matched = findBestInventoryMatch(deal.productQuery).match;
  }
  const ourCost = matched ? matched.unitCost : null;
  const dealP = Number(deal.dealPrice);
  const savingsPerUnit =
    Number.isFinite(dealP) && Number.isFinite(ourCost) && ourCost > 0 ? ourCost - dealP : null;
  const savingsPct =
    savingsPerUnit != null && ourCost > 0 ? (savingsPerUnit / ourCost) * 100 : null;
  return {
    ...deal,
    matchedInventory: matched,
    ourUnitCost: ourCost,
    savingsPerUnit,
    savingsPct,
  };
}

export function listTreasureDeals() {
  const db = readTreasureDb();
  const deals = Array.isArray(db.deals) ? db.deals : [];
  return deals.map(enrichDeal).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

function navAlertFromDb(db) {
  const findings = Array.isArray(db.scan?.findings) ? db.scan.findings : [];
  const scanId = db.scan?.id;
  if (!findings.length || !scanId) return { showNavAlert: false, hotDealCount: 0 };
  const seen = db.lastViewedScanId;
  return {
    showNavAlert: scanId !== seen,
    hotDealCount: findings.length,
  };
}

export function getTreasureSummary() {
  const db = readTreasureDb();
  const { showNavAlert, hotDealCount } = navAlertFromDb(db);
  return { showNavAlert, hotDealCount };
}

export function getTreasureHuntState() {
  const db = readTreasureDb();
  const { showNavAlert, hotDealCount } = navAlertFromDb(db);
  return {
    deals: listTreasureDeals(),
    scan: db.scan,
    showNavAlert,
    hotDealCount,
  };
}

export function markTreasureScanSeen() {
  const db = readTreasureDb();
  if (db.scan?.id) db.lastViewedScanId = db.scan.id;
  else db.lastViewedScanId = null;
  writeTreasureDb(db);
  return { lastViewedScanId: db.lastViewedScanId };
}

function parseTaxPct(body) {
  if (body?.taxPct === undefined || body?.taxPct === null || body?.taxPct === "") {
    return DEFAULT_TREASURE_TAX_PCT;
  }
  const n = Number(body.taxPct);
  if (!Number.isFinite(n)) return DEFAULT_TREASURE_TAX_PCT;
  return Math.min(30, Math.max(0, n));
}

function parseShippingPerUnit(body) {
  if (body?.shippingPerUnit === undefined || body?.shippingPerUnit === null || body?.shippingPerUnit === "") {
    return DEFAULT_TREASURE_SHIPPING_USD;
  }
  const n = Number(body.shippingPerUnit);
  if (!Number.isFinite(n)) return DEFAULT_TREASURE_SHIPPING_USD;
  return Math.min(500, Math.max(0, n));
}

function landedMarketPrice(listPrice, taxPct, shippingPerUnit) {
  const list = Number(listPrice);
  if (!Number.isFinite(list) || list <= 0) return null;
  const tax = Number(taxPct);
  const ship = Number(shippingPerUnit);
  const t = Number.isFinite(tax) ? Math.min(30, Math.max(0, tax)) : 0;
  const s = Number.isFinite(ship) ? Math.min(500, Math.max(0, ship)) : 0;
  return list * (1 + t / 100) + s;
}

/**
 * Compare each in-stock line to a fresh TCGplayer reference price (same engine as inventory refresh).
 * "Hot" = estimated landed cost (list + tax% + flat ship per unit) is at least
 * minSavingsPctBelowCost percent under your recorded unit cost. Only TCGplayer yields a live list price here,
 * so hits are attributed to vendor "TCGplayer" with that link.
 */
async function runTreasureDealScanInternal(body = {}) {
  const minSavingsPctBelowCost = Math.min(80, Math.max(1, Number(body.minSavingsPctBelowCost) || 8));
  const taxPct = parseTaxPct(body);
  const shippingPerUnit = parseShippingPerUnit(body);
  const threshold = 1 - minSavingsPctBelowCost / 100;

  const { items, inventoryEligible, scanMaxItems, hardCap, scanTruncatedByHardCap } = resolveTreasureScanItemSlice(body);

  const findings = [];
  const errors = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    try {
      const ref = await getTcgplayerReferenceMarketForTreasure(item);
      const mp = Number(ref.marketPrice);
      const cost = Number(item.unitCost);
      if (!Number.isFinite(mp) || mp <= 0 || !Number.isFinite(cost) || cost <= 0) {
        continue;
      }
      const landed = landedMarketPrice(mp, taxPct, shippingPerUnit);
      if (landed == null) continue;
      if (landed <= cost * threshold) {
        const savingsPerUnit = cost - landed;
        const savingsPct = (savingsPerUnit / cost) * 100;
        const name = String(item.productName || "").trim();
        const vendorUrl = ref.sourceUrl && /^https?:\/\//i.test(String(ref.sourceUrl)) ? String(ref.sourceUrl) : null;
        findings.push({
          inventoryItemId: item.id,
          productName: name,
          unitCost: cost,
          quantity: Number(item.quantity || 0),
          marketPrice: mp,
          landedMarketPrice: landed,
          taxPctApplied: taxPct,
          shippingPerUnitApplied: shippingPerUnit,
          savingsPerUnit,
          savingsPct,
          vendorName: "TCGplayer",
          vendorUrl,
          priceSource: ref.sheetFallbackUsed ? "tcgplayer (sheet or product page)" : "tcgplayer (search)",
        });
      }
    } catch (e) {
      const msg = e?.message || String(e);
      errors.push({ itemId: item.id, error: msg.slice(0, 200) });
      if (errors.length > 25) break;
    }
    await sleep(SCAN_DELAY_MS);
  }

  const db = readTreasureDb();
  db.scan = {
    id: nanoid(10),
    at: new Date().toISOString(),
    findings,
    errors: errors.slice(0, 25),
    meta: {
      minSavingsPctBelowCost,
      taxPct,
      shippingPerUnit,
      scannedItems: items.length,
      inventoryEligible,
      scanMaxItems,
      hardCap,
      scanTruncatedByHardCap,
    },
  };
  writeTreasureDb(db);
  return db.scan;
}

/** Serialize scans so passive + manual runs never overlap or corrupt the DB. */
let treasureScanQueue = Promise.resolve();

export async function runTreasureDealScan(body = {}) {
  const next = treasureScanQueue.then(() => runTreasureDealScanInternal(body));
  treasureScanQueue = next.catch(() => {});
  return next;
}

function passiveTreasureScanEnvEnabled() {
  const v = String(process.env.TREASURE_PASSIVE_SCAN || "").trim().toLowerCase();
  if (["0", "false", "off", "no"].includes(v)) return false;
  if (["1", "true", "on", "yes"].includes(v)) return true;
  return true;
}

function passiveEnvHours(name, fallback) {
  const n = Number(process.env[name]);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(168, Math.max(1, n));
}

function passiveEnvMinutes(name, fallback) {
  const n = Number(process.env[name]);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1440, Math.max(0, n));
}

/**
 * While the server is up, run the same deal scan on a timer (default: 5 min after boot, then every 8 h).
 * Disable with TREASURE_PASSIVE_SCAN=0. Tune: TREASURE_PASSIVE_SCAN_INTERVAL_HOURS, TREASURE_PASSIVE_SCAN_INITIAL_DELAY_MINUTES,
 * TREASURE_PASSIVE_MAX_ITEMS (omit or 0 = scan all eligible up to hard cap), TREASURE_PASSIVE_MIN_SAVINGS_PCT,
 * TREASURE_PASSIVE_TAX_PCT, TREASURE_PASSIVE_SHIPPING_USD. Hard cap: TREASURE_SCAN_MAX_ITEMS_HARD_CAP.
 */
export function startPassiveTreasureScanScheduler() {
  if (!passiveTreasureScanEnvEnabled()) {
    console.log("[treasure-hunt] Passive background scan disabled (TREASURE_PASSIVE_SCAN=0).");
    return;
  }

  const intervalMs = passiveEnvHours("TREASURE_PASSIVE_SCAN_INTERVAL_HOURS", 8) * 3600_000;
  const initialDelayMs = passiveEnvMinutes("TREASURE_PASSIVE_SCAN_INITIAL_DELAY_MINUTES", 5) * 60_000;
  const passiveMaxRaw = String(process.env.TREASURE_PASSIVE_MAX_ITEMS || "").trim();
  const passiveMaxN = Number(passiveMaxRaw);
  const minSavingsPctBelowCost = Math.min(
    80,
    Math.max(1, Number(process.env.TREASURE_PASSIVE_MIN_SAVINGS_PCT) || 8)
  );
  const taxPct = (() => {
    const raw = String(process.env.TREASURE_PASSIVE_TAX_PCT ?? "").trim();
    if (raw === "") return DEFAULT_TREASURE_TAX_PCT;
    const n = Number(raw);
    return Number.isFinite(n) ? Math.min(30, Math.max(0, n)) : DEFAULT_TREASURE_TAX_PCT;
  })();
  const shippingPerUnit = (() => {
    const raw = String(process.env.TREASURE_PASSIVE_SHIPPING_USD ?? "").trim();
    if (raw === "") return DEFAULT_TREASURE_SHIPPING_USD;
    const n = Number(raw);
    return Number.isFinite(n) ? Math.min(500, Math.max(0, n)) : DEFAULT_TREASURE_SHIPPING_USD;
  })();
  const scanBody = { minSavingsPctBelowCost, taxPct, shippingPerUnit };
  if (passiveMaxRaw !== "" && Number.isFinite(passiveMaxN) && passiveMaxN > 0) {
    scanBody.maxItems = passiveMaxN;
  }

  async function runPassive(reason) {
    try {
      const scan = await runTreasureDealScan(scanBody);
      const hits = scan?.findings?.length ?? 0;
      const checked = scan?.meta?.scannedItems ?? 0;
      console.log(`[treasure-hunt] Passive scan (${reason}): ${hits} hit(s), ${checked} item(s) checked.`);
    } catch (e) {
      console.error("[treasure-hunt] Passive scan failed:", e?.message || e);
    }
  }

  const capNote =
    scanBody.maxItems != null && Number.isFinite(scanBody.maxItems)
      ? `maxItems=${scanBody.maxItems}`
      : `all eligible (hard cap ${getScanHardCap()})`;
  console.log(
    `[treasure-hunt] Passive scan scheduled: first in ${initialDelayMs / 60000} min, every ${intervalMs / 3600000} h (${capNote}, minSavings=${minSavingsPctBelowCost}%, tax=${taxPct}%, ship=$${shippingPerUnit}). Disable: TREASURE_PASSIVE_SCAN=0.`
  );

  setTimeout(() => {
    runPassive("initial");
    setInterval(() => runPassive("interval"), intervalMs);
  }, initialDelayMs);
}

export function addTreasureDeal(body) {
  const productQuery = String(body?.productQuery || "").trim();
  const storeLabel = String(body?.storeLabel || "").trim() || "Other";
  const dealUrl = String(body?.dealUrl || "").trim();
  const dealPrice = Number(body?.dealPrice);
  if (!productQuery) throw new Error("productQuery is required.");
  if (!Number.isFinite(dealPrice) || dealPrice <= 0) throw new Error("dealPrice must be a positive number.");

  const manualId = String(body?.inventoryItemId || "").trim();
  let inventoryItemId = null;
  if (manualId) {
    const inv = readInventoryItems().find((i) => i.id === manualId);
    if (inv) inventoryItemId = inv.id;
  }
  if (!inventoryItemId) {
    const auto = findBestInventoryMatch(productQuery).match;
    inventoryItemId = auto?.id || null;
  }

  const deal = {
    id: nanoid(12),
    createdAt: new Date().toISOString(),
    productQuery,
    storeLabel,
    dealUrl: dealUrl || null,
    dealPrice,
    inventoryItemId,
    notes: String(body?.notes || "").trim() || null,
    status: ["watching", "bought", "passed"].includes(String(body?.status)) ? body.status : "watching",
  };
  const db = readTreasureDb();
  db.deals = Array.isArray(db.deals) ? db.deals : [];
  db.deals.unshift(deal);
  writeTreasureDb(db);
  return enrichDeal(deal);
}

export function deleteTreasureDeal(id) {
  const safeId = String(id || "").trim();
  if (!safeId) throw new Error("id is required.");
  const db = readTreasureDb();
  const before = (db.deals || []).length;
  db.deals = (db.deals || []).filter((d) => d.id !== safeId);
  if (db.deals.length === before) throw new Error("Deal not found.");
  writeTreasureDb(db);
}

export function updateTreasureDeal(id, body) {
  const safeId = String(id || "").trim();
  if (!safeId) throw new Error("id is required.");
  const db = readTreasureDb();
  const d = (db.deals || []).find((x) => x.id === safeId);
  if (!d) throw new Error("Deal not found.");
  if (body.status && ["watching", "bought", "passed"].includes(body.status)) d.status = body.status;
  if (body.notes !== undefined) d.notes = String(body.notes || "").trim() || null;
  if (body.inventoryItemId !== undefined) {
    const mid = String(body.inventoryItemId || "").trim();
    d.inventoryItemId = mid || null;
  }
  writeTreasureDb(db);
  return enrichDeal(d);
}
