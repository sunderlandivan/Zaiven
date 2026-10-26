import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  batchUpdate,
  batchUpdateValues,
  columnLetter,
  getSheetIdByTitle,
  getSpreadsheetMeta,
  getValues,
} from "./googleSheets.js";
import { lookupListing, productIdFromUrl } from "./tcgplayerCatalog.js";

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
const SETTINGS_PATH = path.join(DATA_DIR, "sheet-sync-settings.json");
const ALIASES_PATH = path.join(DATA_DIR, "sheet-sync-aliases.json");

const DEFAULT_SETTINGS = {
  spreadsheetId: "1LkMac4otBWqBpvxsLUe3lsHjdi79-OQZGVGDJwFSKcY",
  purchaseTab: "Inventory26",
  soldTab: "Sold 2026",
  stockTabs: ["Inventory26", "Inventory25"],
  enabled: true,
  autoApply: true,
  intervalMinutes: 30,
  trackFrom: new Date().toISOString().slice(0, 10),
  extraPurchaseSenders: [
    "gtsdistribution.com",
    "southernhobby.com",
    "alliance-games.com",
    "acdd.com",
    "madal.com",
  ],
  forwardedInboxes: ["theivan@live.com"],
  ebayFeePercent: 0.1325,
  ebayFeeFixed: 0.3,
};

function readJsonFile(p, fallback) {
  if (!fs.existsSync(p)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJsonFile(p, value) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(p, JSON.stringify(value, null, 2));
}

export function getSheetSyncSettings() {
  const saved = readJsonFile(SETTINGS_PATH, null);
  if (!saved) {
    writeJsonFile(SETTINGS_PATH, DEFAULT_SETTINGS);
    return { ...DEFAULT_SETTINGS };
  }
  return { ...DEFAULT_SETTINGS, ...saved };
}

export function saveSheetSyncSettings(patch = {}) {
  const current = getSheetSyncSettings();
  const next = { ...current };
  const allowed = [
    "spreadsheetId",
    "purchaseTab",
    "soldTab",
    "stockTabs",
    "enabled",
    "autoApply",
    "intervalMinutes",
    "trackFrom",
    "extraPurchaseSenders",
    "forwardedInboxes",
    "ebayFeePercent",
    "ebayFeeFixed",
  ];
  for (const key of allowed) {
    if (key in patch) next[key] = patch[key];
  }
  next.intervalMinutes = Math.max(5, Math.min(720, Number(next.intervalMinutes) || 30));
  if (typeof next.stockTabs === "string") {
    next.stockTabs = next.stockTabs.split(",").map((s) => s.trim()).filter(Boolean);
  }
  for (const key of ["extraPurchaseSenders", "forwardedInboxes"]) {
    if (typeof next[key] === "string") {
      next[key] = next[key]
        .split(/[\s,]+/)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
    }
  }
  writeJsonFile(SETTINGS_PATH, next);
  return next;
}

// ---------- name matching ----------

const STOP_WORDS = new Set([
  "the", "of", "and", "a", "an", "tcg", "pokemon", "magic", "gathering", "mtg", "trading", "card",
  "game", "english", "new", "sealed", "factory", "edition", "unlimited", "near", "mint",
]);

const FORM_PATTERNS = [
  ["case", /\bcase\b/],
  ["display", /\bdisplay\b/],
  ["collector", /\bcollector/],
  ["play", /\bplay\s+booster\b/],
  ["bundle", /\bbundle\b/],
  ["etb", /\b(etb|elite trainer)\b/],
  ["blister", /\bblister\b/],
  ["tin", /\btin\b/],
  ["commander", /\bcommander\b/],
  ["collection", /\bcollection\b/],
  ["pack", /\bpack\b/],
];

function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/pok[eé]mon/g, "pokemon")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokens(s) {
  return new Set(normalize(s).split(" ").filter((t) => t.length > 1 && !STOP_WORDS.has(t)));
}

function forms(s) {
  const n = ` ${normalize(s)} `;
  return new Set(FORM_PATTERNS.filter(([, re]) => re.test(n)).map(([k]) => k));
}

/** Sheet Item IDs look like "<Product> - <Set name> (<CODE>)"; the product part alone is often the best signal. */
export function scoreItemMatch(description, itemId) {
  const full = scoreAgainst(description, itemId);
  const head = String(itemId || "").split(/\s+-\s+/)[0];
  if (!head || head === itemId) return full;
  return Math.max(full, scoreAgainst(description, head));
}

function scoreAgainst(description, itemId) {
  const na = normalize(description);
  const nb = normalize(itemId);
  if (!na || !nb) return 0;
  if (na === nb) return 100;
  const at = tokens(description);
  const bt = tokens(itemId);
  if (!at.size || !bt.size) return 0;
  let common = 0;
  for (const t of at) if (bt.has(t)) common += 1;
  const minCover = common / Math.min(at.size, bt.size);
  const maxCover = common / Math.max(at.size, bt.size);
  let score = 100 * minCover * (0.65 + 0.35 * maxCover);
  const onlyA = [...at].some((t) => !bt.has(t) && !/^\d+$/.test(t));
  const onlyB = [...bt].some((t) => !at.has(t) && !/^\d+$/.test(t));
  if (onlyA && onlyB) score -= 30;
  const fa = forms(description);
  const fb = forms(itemId);
  for (const f of new Set([...fa, ...fb])) {
    if (fa.has(f) !== fb.has(f)) score -= 30;
  }
  return Math.max(0, Math.round(score));
}

function readAliases() {
  return readJsonFile(ALIASES_PATH, {});
}

export function rememberAlias(description, itemId) {
  const key = normalize(description);
  if (!key || !itemId) return;
  const aliases = readAliases();
  aliases[key] = itemId;
  writeJsonFile(ALIASES_PATH, aliases);
}

export function aliasFor(description) {
  return readAliases()[normalize(description)] || null;
}

/**
 * Best match across the given rows. Returns { row, score, confident, candidates }.
 * rows: [{ tab, rowNumber, itemId, qty, ... }]
 */
export function findBestRow(description, rows, { requireStock = false, productId = null, title = null } = {}) {
  const alias = aliasFor(description);
  const pool = requireStock ? rows.filter((r) => Number(r.qty) > 0) : rows;
  if (alias) {
    const hit = pool.find((r) => r.itemId === alias) || rows.find((r) => r.itemId === alias);
    if (hit) return { row: hit, score: 100, confident: true, viaAlias: true, candidates: [hit] };
  }
  // Item IDs follow the TCGplayer listing title ("Product Name - Set (CODE)") and rows carry the listing link.
  const lc = (s) => String(s || "").trim().toLowerCase();
  const exact = (r) =>
    (productId && productIdFromUrl(r.link) === Number(productId)) ||
    (title && lc(r.itemId) === lc(title)) ||
    lc(r.itemId) === lc(description) ||
    lc(r.itemId).startsWith(`${lc(description)} - `);
  const exactHits = pool.filter(exact);
  if (exactHits.length) {
    const hit = exactHits.find((r) => Number(r.qty) > 0) || exactHits[0];
    return { row: hit, score: 100, confident: true, viaListing: true, candidates: exactHits.slice(0, 5).map((r) => ({ ...r, score: 100 })) };
  }
  const scored = pool
    .map((r) => ({ r, s: scoreItemMatch(description, r.itemId) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s);
  const best = scored[0];
  if (!best) return { row: null, score: 0, confident: false, candidates: [] };
  const second = scored.find((x) => x.r.itemId !== best.r.itemId);
  const lead = best.s - (second?.s || 0);
  return {
    row: best.r,
    score: best.s,
    confident: best.s >= 75 && lead >= 12,
    candidates: scored.slice(0, 5).map((x) => ({ ...x.r, score: x.s })),
  };
}

// ---------- tab reading ----------

const COLUMN_RULES = {
  itemId: (h) => h === "item id" || h.endsWith(" item id") || h === "product",
  code: (h) => h === "item name",
  type: (h) => h === "type",
  qty: (h) => h === "qty" || h === "quantity",
  cost: (h) => h.startsWith("cost"),
  totalInv: (h) => h.startsWith("total inv"),
  lastRetail: (h) => h.startsWith("last retail"),
  status: (h) => h === "status",
  link: (h) => h.includes("tcg link") || h === "link",
  soldUnit: (h) => /^sold\b/.test(h) && !/ttl|total/.test(h),
  soldTotal: (h) => /^sold\b/.test(h) && /ttl|total/.test(h),
  shipping: (h) => h.startsWith("shipping"),
  fees: (h) => h === "fees",
  calcShipping: (h) => h.startsWith("calc shipping"),
  date: (h) => h === "date" || h === "sale date",
  orderNumber: (h) => h === "order #" || h === "order number",
  channel: (h) => h === "channel",
  marketTax: (h) => h.startsWith("marketplace tax"),
  ourTax: (h) => h.startsWith("sales tax we collected"),
  labelCost: (h) => h.startsWith("label cost"),
  refund: (h) => h.startsWith("refund"),
  feeBasis: (h) => h === "fee basis",
  notes: (h) => h === "notes",
};

/** Tax-record columns appended to the right of the Sold tab (after Date). */
export const SOLD_EXTRA_HEADERS = [
  "Order #",
  "Channel",
  "Marketplace Tax (platform collected & remitted)",
  "Sales Tax We Collected (owed to CDTFA)",
  "Label Cost",
  "Refund",
  "Fee Basis",
  "Notes",
];

function normHeader(h) {
  return String(h ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function mapColumns(headerRow) {
  const cols = {};
  headerRow.forEach((raw, idx) => {
    const h = normHeader(raw);
    if (!h) return;
    for (const [key, rule] of Object.entries(COLUMN_RULES)) {
      if (cols[key] == null && rule(h)) cols[key] = idx;
    }
  });
  return cols;
}

function num(v) {
  if (typeof v === "number") return v;
  const n = Number(String(v ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** Reads a tab: header detection, column map, data rows, formula map of the last data row. */
export async function readTab(tab) {
  const { spreadsheetId } = getSheetSyncSettings();
  const values = await getValues(spreadsheetId, tab, "A1:AZ", "UNFORMATTED_VALUE");
  let headerIdx = -1;
  for (let i = 0; i < Math.min(values.length, 15); i++) {
    const cells = (values[i] || []).map(normHeader);
    if (cells.some((c) => COLUMN_RULES.itemId(c)) && cells.some((c) => COLUMN_RULES.qty(c))) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) throw new Error(`Could not find the header row (Item ID + Qty) in tab "${tab}".`);
  const headerRow = values[headerIdx] || [];
  const cols = mapColumns(headerRow);
  if (cols.itemId == null || cols.qty == null) {
    throw new Error(`Tab "${tab}" is missing an Item ID or Qty column.`);
  }
  const rows = [];
  let lastDataIdx = headerIdx;
  for (let i = headerIdx + 1; i < values.length; i++) {
    const r = values[i] || [];
    const itemId = String(r[cols.itemId] ?? "").trim();
    if (!itemId) continue;
    lastDataIdx = i;
    rows.push({
      tab,
      rowNumber: i + 1,
      itemId,
      code: cols.code != null ? String(r[cols.code] ?? "") : "",
      type: cols.type != null ? String(r[cols.type] ?? "") : "",
      qty: num(r[cols.qty]),
      cost: cols.cost != null ? num(r[cols.cost]) : 0,
      lastRetail: cols.lastRetail != null ? num(r[cols.lastRetail]) : 0,
      status: cols.status != null ? String(r[cols.status] ?? "") : "",
      link: cols.link != null ? String(r[cols.link] ?? "") : "",
      calcShipping: cols.calcShipping != null ? num(r[cols.calcShipping]) : 0,
      date: cols.date != null ? r[cols.date] : null,
      orderNumber: cols.orderNumber != null ? String(r[cols.orderNumber] ?? "").trim() : "",
    });
  }
  let templateFormulas = [];
  if (lastDataIdx > headerIdx) {
    const rowNum = lastDataIdx + 1;
    const f = await getValues(spreadsheetId, tab, `A${rowNum}:AZ${rowNum}`, "FORMULA");
    templateFormulas = f[0] || [];
  }
  return {
    tab,
    headerRowNumber: headerIdx + 1,
    headers: headerRow,
    cols,
    rows,
    lastDataRowNumber: lastDataIdx + 1,
    templateFormulas,
    width: Math.max(headerRow.length, templateFormulas.length),
  };
}

export async function readStockRows() {
  const settings = getSheetSyncSettings();
  const tabs = [...new Set([settings.purchaseTab, ...(settings.stockTabs || [])])];
  const out = [];
  for (const tab of tabs) {
    try {
      const t = await readTab(tab);
      out.push(...t.rows);
    } catch (e) {
      if (tab === settings.purchaseTab) throw e;
    }
  }
  return out;
}

// ---------- writing ----------

function isFormula(v) {
  return typeof v === "string" && v.startsWith("=");
}

function sheetDate(iso) {
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`;
}

function dayKey(v) {
  const s = String(v ?? "").trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const y = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]);
    return `${y}-${Number(m[1])}-${Number(m[2])}`;
  }
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${Number(iso[1])}-${Number(iso[2])}-${Number(iso[3])}`;
  return s;
}

function sameDay(a, b) {
  return Boolean(a) && Boolean(b) && dayKey(a) === dayKey(b);
}

const ALWAYS_WRITE = new Set(["itemId", "code", "type", "qty", "cost", "soldUnit", "shipping", "fees", "date", "link", "status", "lastRetail"]);

/**
 * Appends a row right below the last data row, copying the template row (formulas, formats,
 * dropdowns), then writes the provided values. Non-formula template cells we don't set are cleared.
 */
async function appendRow(table, valuesByKey, { afterRow = null } = {}) {
  const { spreadsheetId } = getSheetSyncSettings();
  const { sheetId } = await getSheetIdByTitle(spreadsheetId, table.tab);
  const lastRow = table.lastDataRowNumber;
  const newRow = (afterRow && afterRow < lastRow ? afterRow : lastRow) + 1;
  // Inserting above the template row pushes it down by one.
  const templateRow = lastRow >= newRow ? lastRow + 1 : lastRow;
  const width = Math.max(table.width, 1);

  await batchUpdate(spreadsheetId, [
    {
      insertDimension: {
        range: { sheetId, dimension: "ROWS", startIndex: newRow - 1, endIndex: newRow },
        inheritFromBefore: true,
      },
    },
    {
      copyPaste: {
        source: { sheetId, startRowIndex: templateRow - 1, endRowIndex: templateRow, startColumnIndex: 0, endColumnIndex: width },
        destination: { sheetId, startRowIndex: newRow - 1, endRowIndex: newRow, startColumnIndex: 0, endColumnIndex: width },
        pasteType: "PASTE_NORMAL",
      },
    },
  ]);

  const keyByCol = new Map(Object.entries(table.cols).map(([k, idx]) => [idx, k]));
  const updates = [];
  for (let c = 0; c < width; c++) {
    const key = keyByCol.get(c);
    const template = table.templateFormulas[c];
    const hasValue = key && valuesByKey[key] !== undefined && valuesByKey[key] !== null;
    if (hasValue && (ALWAYS_WRITE.has(key) || !isFormula(template))) {
      updates.push({ range: `${columnLetter(c)}${newRow}`, values: [[valuesByKey[key]]] });
    } else if (key && !isFormula(template) && template !== undefined && template !== "") {
      // Only clear item-specific columns; unmapped constants (e.g. Calc Shipping Per Item) stay as copied.
      updates.push({ range: `${columnLetter(c)}${newRow}`, values: [[""]] });
    }
  }
  await batchUpdateValues(spreadsheetId, table.tab, updates);
  return newRow;
}

async function updateCells(tab, cells) {
  const { spreadsheetId } = getSheetSyncSettings();
  await batchUpdateValues(
    spreadsheetId,
    tab,
    cells.map((c) => ({ range: c.a1, values: [[c.value]] }))
  );
}

/** prices: [{ rowNumber, price }] written to the tab's Last Retail column. */
export async function setLastRetail(tab, prices) {
  const table = await readTab(tab);
  if (table.cols.lastRetail == null) throw new Error(`Tab "${tab}" has no Last Retail column.`);
  const col = columnLetter(table.cols.lastRetail);
  await updateCells(tab, prices.map((p) => ({ a1: `${col}${p.rowNumber}`, value: round2(p.price) })));
  return prices.length;
}

function guessCode(name, type) {
  const n = `${name} ${type}`.toLowerCase();
  if (/elite trainer|\betb\b/.test(n)) return { code: "ETB", type: "ETB" };
  if (/booster bundle/.test(n)) return { code: "BB", type: "Booster Bundle" };
  if (/collector/.test(n)) return { code: "COL", type: "Collection" };
  if (/blister|pack\b/.test(n)) return { code: "PAK", type: "Pack" };
  if (/near mint|lightly played|#\d+/.test(n)) return { code: "SIN", type: "Singles" };
  return { code: "BOX", type: "Box" };
}

const round2 = (n) => Math.round(Number(n) * 100) / 100;

/**
 * Purchase: raise Qty (weighted-average cost) on an existing purchase-tab row, or add a new row.
 * line: { description, qty, unitCost, targetItemId?, createNew?, template? }
 */
export async function applyPurchaseLine(line) {
  const settings = getSheetSyncSettings();
  const table = await readTab(settings.purchaseTab);
  const qty = Math.max(1, Math.round(Number(line.qty) || 1));
  const unitCost = round2(line.unitCost || 0);
  const existing = line.targetItemId ? table.rows.find((r) => r.itemId === line.targetItemId) : null;

  if (existing && !line.createNew) {
    const newQty = existing.qty + qty;
    const cells = [{ a1: `${columnLetter(table.cols.qty)}${existing.rowNumber}`, value: newQty }];
    const costIsFormula = isFormula(table.templateFormulas[table.cols.cost]);
    if (table.cols.cost != null && unitCost > 0 && !costIsFormula) {
      const avg = existing.qty > 0 ? round2((existing.qty * existing.cost + qty * unitCost) / newQty) : unitCost;
      cells.push({ a1: `${columnLetter(table.cols.cost)}${existing.rowNumber}`, value: avg });
    }
    if (table.cols.status != null && /sold out/i.test(existing.status)) {
      cells.push({ a1: `${columnLetter(table.cols.status)}${existing.rowNumber}`, value: "" });
    }
    await updateCells(table.tab, cells);
    return { action: "qty_raised", tab: table.tab, row: existing.rowNumber, itemId: existing.itemId, from: existing.qty, to: newQty };
  }

  let tpl = line.template || {};
  if (!tpl.link) {
    const listing = await lookupListing(line.newItemId || line.description);
    if (listing) {
      tpl = { ...tpl, itemId: tpl.itemId || listing.title, link: listing.url, lastRetail: tpl.lastRetail || listing.marketPrice || undefined };
    }
  }
  const itemId = String(line.newItemId || tpl.itemId || line.description).trim();
  const guess = guessCode(itemId, tpl.type || "");
  const row = await appendRow(table, {
    itemId,
    code: tpl.code || guess.code,
    type: tpl.type || guess.type,
    qty,
    cost: unitCost,
    lastRetail: tpl.lastRetail || undefined,
    link: tpl.link || undefined,
  });
  return { action: "row_added", tab: table.tab, row, itemId, qty };
}

/** Sold rows can list several order numbers (owner batch rows), comma separated. */
export function soldRowHasOrder(row, orderNumber, itemId) {
  const want = String(orderNumber || "").trim().toUpperCase();
  if (!want) return false;
  const orders = String(row.orderNumber || "").toUpperCase().split(/[,;\s]+/).filter(Boolean);
  return orders.includes(want) && (!itemId || row.itemId === itemId);
}

/**
 * Sale: log a row in the Sold tab and lower Qty on the matched stock row.
 * line: { description, qty, unitPrice, shipping, fees, date, stockRow?, single?,
 *         orderNumber?, channel?, marketTax?, ourTax?, labelCost?, refund?, feeBasis?, notes? }
 */
export async function applySaleLine(line) {
  const settings = getSheetSyncSettings();
  const qty = Math.max(1, Math.round(Number(line.qty) || 1));
  const stock = line.stockRow || null;
  const results = [];

  const sold = await readTab(settings.soldTab);
  const expectedItemId = stock?.itemId || line.itemId || line.description;
  const logged = sold.rows.find((r) => soldRowHasOrder(r, line.orderNumber, expectedItemId));
  if (logged) {
    results.push({ action: "sold_row_exists", tab: sold.tab, row: logged.rowNumber, itemId: logged.itemId, via: "order number" });
    return results;
  }

  if (stock) {
    const table = await readTab(stock.tab);
    const fresh = table.rows.find((r) => r.itemId === stock.itemId);
    if (!fresh) throw new Error(`Row "${stock.itemId}" no longer exists in ${stock.tab}.`);
    const newQty = Math.max(0, fresh.qty - qty);
    const cells = [{ a1: `${columnLetter(table.cols.qty)}${fresh.rowNumber}`, value: newQty }];
    if (newQty === 0 && table.cols.status != null) {
      cells.push({ a1: `${columnLetter(table.cols.status)}${fresh.rowNumber}`, value: "Sold out" });
    }
    await updateCells(table.tab, cells);
    results.push({ action: "qty_lowered", tab: table.tab, row: fresh.rowNumber, itemId: fresh.itemId, from: fresh.qty, to: newQty });
    line = { ...line, cost: fresh.cost, code: fresh.code, type: fresh.type, itemId: fresh.itemId };
  }

  const itemId = line.itemId || line.description;
  const dateStr = sheetDate(line.date);
  const dup = sold.rows.find(
    (r) => r.itemId === itemId && Number(r.qty) === qty && sameDay(r.date, dateStr) && (!line.orderNumber || !r.orderNumber)
  );
  if (dup) {
    results.push({ action: "sold_row_exists", tab: sold.tab, row: dup.rowNumber, itemId });
    return results;
  }
  const guess = line.single ? { code: "SIN", type: "Singles" } : guessCode(itemId, line.type || "");
  const unitPrice = round2(line.unitPrice || 0);
  // Keep Sold rows in date order when a late (reviewed) sale is logged.
  const saleDay = new Date(`${String(line.date).slice(0, 10)}T12:00:00Z`).getTime();
  const sheetDay = (v) => {
    if (typeof v === "number") return Math.round((v - 25569) * 86400000) + 43200000;
    const k = dayKey(v).split("-").map(Number);
    return k.length === 3 && k.every(Number.isFinite) ? Date.UTC(k[0], k[1] - 1, k[2], 12) : NaN;
  };
  const later = sold.rows.find((r) => sheetDay(r.date) > saleDay);
  const afterRow = later ? later.rowNumber - 1 : null;
  const money = (v) => (v === undefined || v === null || v === "" ? undefined : round2(v));
  const hasCost = line.cost !== undefined && line.cost !== null && line.cost !== "";
  const row = await appendRow(sold, {
    itemId,
    code: line.code || guess.code,
    type: line.type || guess.type,
    qty,
    cost: hasCost || !line.costUnknown ? round2(line.cost || 0) : "",
    totalInv: round2((line.cost || 0) * qty),
    soldUnit: unitPrice,
    soldTotal: round2(unitPrice * qty),
    shipping: round2(line.shipping || 0),
    fees: round2(line.fees || 0),
    date: dateStr,
    orderNumber: line.orderNumber ? String(line.orderNumber) : undefined,
    channel: line.channel || undefined,
    marketTax: money(line.marketTax),
    ourTax: money(line.ourTax),
    labelCost: money(line.labelCost),
    refund: money(line.refund),
    feeBasis: line.feeBasis || undefined,
    notes: line.notes || undefined,
  }, { afterRow });
  results.push({ action: "sold_row_added", tab: sold.tab, row, itemId, qty });
  return results;
}

/** Adds the Order #/Channel/tax columns to the right of the Sold tab's header once; existing cells are untouched. */
export async function ensureSoldColumns() {
  const settings = getSheetSyncSettings();
  const table = await readTab(settings.soldTab);
  if (table.cols.orderNumber != null) return { added: false, cols: table.cols };
  const { spreadsheetId } = settings;
  const meta = await getSpreadsheetMeta(spreadsheetId);
  const sheet = meta.sheets.find((s) => s.properties.title === settings.soldTab);
  const { sheetId } = sheet.properties;
  const columnCount = sheet.properties.gridProperties?.columnCount || 0;
  const lastHeader = table.headers.reduce((last, h, i) => (String(h ?? "").trim() ? i : last), 0);
  const start = lastHeader + 1;
  const end = start + SOLD_EXTRA_HEADERS.length;
  const requests = [];
  if (columnCount < end) {
    requests.push({ appendDimension: { sheetId, dimension: "COLUMNS", length: end - columnCount } });
  }
  const headerIdx = table.headerRowNumber - 1;
  requests.push({
    copyPaste: {
      source: { sheetId, startRowIndex: headerIdx, endRowIndex: headerIdx + 1, startColumnIndex: lastHeader, endColumnIndex: lastHeader + 1 },
      destination: { sheetId, startRowIndex: headerIdx, endRowIndex: headerIdx + 1, startColumnIndex: start, endColumnIndex: end },
      pasteType: "PASTE_FORMAT",
    },
  });
  await batchUpdate(spreadsheetId, requests);
  await batchUpdateValues(spreadsheetId, table.tab, [
    { range: `${columnLetter(start)}${table.headerRowNumber}:${columnLetter(end - 1)}${table.headerRowNumber}`, values: [SOLD_EXTRA_HEADERS] },
  ]);
  const fresh = await readTab(settings.soldTab);
  return { added: true, cols: fresh.cols };
}

/** Quick health check: confirms access and shows detected columns per tab. */
export async function testSheetConnection() {
  const settings = getSheetSyncSettings();
  const tabs = [...new Set([settings.purchaseTab, settings.soldTab, ...(settings.stockTabs || [])])];
  const out = [];
  for (const tab of tabs) {
    try {
      const t = await readTab(tab);
      out.push({ tab, ok: true, headerRow: t.headerRowNumber, rows: t.rows.length, lastRow: t.lastDataRowNumber, columns: Object.keys(t.cols) });
    } catch (e) {
      out.push({ tab, ok: false, error: e.message });
    }
  }
  return out;
}
