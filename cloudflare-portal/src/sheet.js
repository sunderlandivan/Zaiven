// Port of server/sheetLedger.js (reading, matching, sale logging) restricted to the tabs in google.js ALLOWED_TABS.
import { readDoc, writeDoc } from "./docs.js";
import { ALLOWED_TABS, batchUpdateTab, batchUpdateValues, columnLetter, getSheetIdByTitle, getValues } from "./google.js";

const DEFAULT_SETTINGS = { spreadsheetId: "1LkMac4otBWqBpvxsLUe3lsHjdi79-OQZGVGDJwFSKcY", purchaseTab: "Inventory26", soldTab: "Sold 2026", stockTabs: ["Inventory26"] };

export async function getSheetSettings(env) {
  const saved = (await readDoc(env, "sheet-sync-settings", {})) || {};
  const s = { ...DEFAULT_SETTINGS, ...saved };
  return {
    ...s,
    purchaseTab: "Inventory26",
    soldTab: "Sold 2026",
    stockTabs: [...new Set(["Inventory26", ...(s.stockTabs || [])])].filter((t) => ALLOWED_TABS.has(t)),
    excludedTabs: (s.stockTabs || []).filter((t) => !ALLOWED_TABS.has(t)),
  };
}

// ---------- name matching (same scoring as the PC portal) ----------

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

export function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/pok[eé]mon/g, "pokemon")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const tokens = (s) => new Set(normalize(s).split(" ").filter((t) => t.length > 1 && !STOP_WORDS.has(t)));
const forms = (s) => {
  const n = ` ${normalize(s)} `;
  return new Set(FORM_PATTERNS.filter(([, re]) => re.test(n)).map(([k]) => k));
};

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
  for (const f of new Set([...fa, ...fb])) if (fa.has(f) !== fb.has(f)) score -= 30;
  return Math.max(0, Math.round(score));
}

export function scoreItemMatch(description, itemId) {
  const full = scoreAgainst(description, itemId);
  const head = String(itemId || "").split(/\s+-\s+/)[0];
  if (!head || head === itemId) return full;
  return Math.max(full, scoreAgainst(description, head));
}

/** rows: sheet rows; aliases: sheet-sync-aliases doc. Same rules as the PC portal's findBestRow (minus TCGplayer lookups). */
export function findBestRow(description, rows, aliases = {}, { requireStock = false } = {}) {
  const pool = requireStock ? rows.filter((r) => Number(r.qty) > 0) : rows;
  const alias = aliases[normalize(description)];
  if (alias) {
    const hit = pool.find((r) => r.itemId === alias) || rows.find((r) => r.itemId === alias);
    if (hit) return { row: hit, score: 100, confident: true, viaAlias: true };
  }
  const lc = (s) => String(s || "").trim().toLowerCase();
  const exactHits = pool.filter((r) => lc(r.itemId) === lc(description) || lc(r.itemId).startsWith(`${lc(description)} - `));
  if (exactHits.length) return { row: exactHits.find((r) => Number(r.qty) > 0) || exactHits[0], score: 100, confident: true };
  const scored = pool
    .map((r) => ({ r, s: scoreItemMatch(description, r.itemId) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s);
  const best = scored[0];
  if (!best) return { row: null, score: 0, confident: false };
  const second = scored.find((x) => x.r.itemId !== best.r.itemId);
  return { row: best.r, score: best.s, confident: best.s >= 75 && best.s - (second?.s || 0) >= 12 };
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
};

const normHeader = (h) => String(h ?? "").toLowerCase().replace(/\s+/g, " ").trim();
const num = (v) => {
  if (typeof v === "number") return v;
  const n = Number(String(v ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

/** withTemplate: also fetch the formulas of the last data row (needed only when appending rows). */
export async function readTab(env, budget, tab, { withTemplate = false } = {}) {
  const { spreadsheetId } = await getSheetSettings(env);
  const values = await getValues(env, budget, spreadsheetId, tab, "A1:AZ", "UNFORMATTED_VALUE");
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
  const cols = {};
  headerRow.forEach((raw, idx) => {
    const h = normHeader(raw);
    if (!h) return;
    for (const [key, rule] of Object.entries(COLUMN_RULES)) if (cols[key] == null && rule(h)) cols[key] = idx;
  });
  if (cols.itemId == null || cols.qty == null) throw new Error(`Tab "${tab}" is missing an Item ID or Qty column.`);
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
      ...(cols.soldUnit != null ? { soldUnit: num(r[cols.soldUnit]) } : {}),
      ...(cols.soldTotal != null ? { soldTotal: num(r[cols.soldTotal]) } : {}),
      ...(cols.shipping != null ? { shipping: num(r[cols.shipping]) } : {}),
      ...(cols.fees != null ? { fees: num(r[cols.fees]) } : {}),
    });
  }
  let templateFormulas = [];
  if (withTemplate && lastDataIdx > headerIdx) {
    const rowNum = lastDataIdx + 1;
    templateFormulas = (await getValues(env, budget, spreadsheetId, tab, `A${rowNum}:AZ${rowNum}`, "FORMULA"))[0] || [];
  }
  return { tab, headerRowNumber: headerIdx + 1, headers: headerRow, cols, rows, lastDataRowNumber: lastDataIdx + 1, templateFormulas, width: Math.max(headerRow.length, templateFormulas.length) };
}

// ---------- mirror (read-only, safe while the PC portal is active) ----------

async function sha256(text) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Reads Inventory26 + Sold 2026 into the "sheet-snapshot" doc; writes D1 only when the sheet changed. */
export async function mirrorSheet(env, budget) {
  const settings = await getSheetSettings(env);
  const tabs = {};
  for (const tab of [settings.purchaseTab, settings.soldTab]) {
    const t = await readTab(env, budget, tab);
    tabs[tab] = { headerRow: t.headerRowNumber, lastRow: t.lastDataRowNumber, columns: Object.keys(t.cols), rows: t.rows };
  }
  const hash = await sha256(JSON.stringify(tabs));
  const prev = await readDoc(env, "sheet-snapshot-meta", {});
  const at = new Date().toISOString();
  const summary = Object.fromEntries(Object.entries(tabs).map(([k, v]) => [k, { rows: v.rows.length, lastRow: v.lastRow, inStock: v.rows.filter((r) => r.qty > 0).length }]));
  if (prev.hash !== hash) {
    await writeDoc(env, "sheet-snapshot", { at, tabs });
    await writeDoc(env, "sheet-snapshot-meta", { hash, at, checkedAt: at, changedAt: at, summary });
    return { changed: true, summary };
  }
  await writeDoc(env, "sheet-snapshot-meta", { ...prev, checkedAt: at, summary });
  return { changed: false, summary };
}

// ---------- writing a sale (used only when the cloud portal is the active host) ----------

const isFormula = (v) => typeof v === "string" && v.startsWith("=");
const round2 = (n) => Math.round(Number(n) * 100) / 100;

function sheetDate(iso) {
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`;
}

function dayKey(v) {
  const s = String(v ?? "").trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) return `${Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3])}-${Number(m[1])}-${Number(m[2])}`;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? `${Number(iso[1])}-${Number(iso[2])}-${Number(iso[3])}` : s;
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

const ALWAYS_WRITE = new Set(["itemId", "code", "type", "qty", "cost", "soldUnit", "shipping", "fees", "date", "link", "status", "lastRetail"]);

async function appendRow(env, budget, table, valuesByKey, { afterRow = null } = {}) {
  const { spreadsheetId } = await getSheetSettings(env);
  const sheetId = await getSheetIdByTitle(env, budget, spreadsheetId, table.tab);
  const lastRow = table.lastDataRowNumber;
  const newRow = (afterRow && afterRow < lastRow ? afterRow : lastRow) + 1;
  const templateRow = lastRow >= newRow ? lastRow + 1 : lastRow;
  const width = Math.max(table.width, 1);
  await batchUpdateTab(env, budget, spreadsheetId, table.tab, [
    { insertDimension: { range: { sheetId, dimension: "ROWS", startIndex: newRow - 1, endIndex: newRow }, inheritFromBefore: true } },
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
    if (hasValue && (ALWAYS_WRITE.has(key) || !isFormula(template))) updates.push({ range: `${columnLetter(c)}${newRow}`, values: [[valuesByKey[key]]] });
    else if (key && !isFormula(template) && template !== undefined && template !== "") updates.push({ range: `${columnLetter(c)}${newRow}`, values: [[""]] });
  }
  await batchUpdateValues(env, budget, spreadsheetId, table.tab, updates);
  return newRow;
}

/**
 * Sale: lower Qty on the matched Inventory26 row and log a Sold 2026 row (same rules as the PC portal).
 * line: { description, qty, unitPrice, shipping, fees, date, stockRow?, single? }
 */
export async function applySaleLine(env, budget, line) {
  const settings = await getSheetSettings(env);
  const { spreadsheetId } = settings;
  const qty = Math.max(1, Math.round(Number(line.qty) || 1));
  const results = [];
  if (line.stockRow) {
    if (line.stockRow.tab !== settings.purchaseTab) throw new Error(`Row is in ${line.stockRow.tab}; the cloud portal only edits ${settings.purchaseTab}.`);
    const table = await readTab(env, budget, settings.purchaseTab);
    const fresh = table.rows.find((r) => r.itemId === line.stockRow.itemId);
    if (!fresh) throw new Error(`Row "${line.stockRow.itemId}" no longer exists in ${table.tab}.`);
    const newQty = Math.max(0, fresh.qty - qty);
    const cells = [{ range: `${columnLetter(table.cols.qty)}${fresh.rowNumber}`, values: [[newQty]] }];
    if (newQty === 0 && table.cols.status != null) cells.push({ range: `${columnLetter(table.cols.status)}${fresh.rowNumber}`, values: [["Sold out"]] });
    await batchUpdateValues(env, budget, spreadsheetId, table.tab, cells);
    results.push({ action: "qty_lowered", tab: table.tab, row: fresh.rowNumber, itemId: fresh.itemId, from: fresh.qty, to: newQty });
    line = { ...line, cost: fresh.cost, code: fresh.code, type: fresh.type, itemId: fresh.itemId };
  }
  const sold = await readTab(env, budget, settings.soldTab, { withTemplate: true });
  const itemId = line.itemId || line.description;
  const dateStr = sheetDate(line.date);
  const dup = sold.rows.find((r) => r.itemId === itemId && Number(r.qty) === qty && dayKey(r.date) === dayKey(dateStr));
  if (dup) {
    results.push({ action: "sold_row_exists", tab: sold.tab, row: dup.rowNumber, itemId });
    return results;
  }
  const guess = line.single ? { code: "SIN", type: "Singles" } : guessCode(itemId, line.type || "");
  const unitPrice = round2(line.unitPrice || 0);
  const saleDay = new Date(`${String(line.date).slice(0, 10)}T12:00:00Z`).getTime();
  const sheetDay = (v) => {
    if (typeof v === "number") return Math.round((v - 25569) * 86400000) + 43200000;
    const k = dayKey(v).split("-").map(Number);
    return k.length === 3 && k.every(Number.isFinite) ? Date.UTC(k[0], k[1] - 1, k[2], 12) : NaN;
  };
  const later = sold.rows.find((r) => sheetDay(r.date) > saleDay);
  const row = await appendRow(
    env,
    budget,
    sold,
    {
      itemId,
      code: line.code || guess.code,
      type: line.type || guess.type,
      qty,
      cost: round2(line.cost || 0),
      totalInv: round2((line.cost || 0) * qty),
      soldUnit: unitPrice,
      soldTotal: round2(unitPrice * qty),
      shipping: round2(line.shipping || 0),
      fees: round2(line.fees || 0),
      date: dateStr,
    },
    { afterRow: later ? later.rowNumber - 1 : null }
  );
  results.push({ action: "sold_row_added", tab: sold.tab, row, itemId, qty });
  return results;
}
