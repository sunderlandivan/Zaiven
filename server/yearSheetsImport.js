import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import xlsx from "xlsx";
import {
  appendProfitHistorySnapshot,
  normalizeName,
} from "./inventoryAgent.js";

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
const IMPORTS_DIR = path.join(DATA_DIR, "imports");
const INVENTORY_DB_PATH = path.join(DATA_DIR, "inventory-db.json");
const TAX_PREP_DB_PATH = path.join(DATA_DIR, "tax-prep-db.json");
const LEDGER_PATH = path.join(DATA_DIR, "inventory-sales-ledger.json");

/** Games this business sells — used for tagging / filtering. */
export const TRACKED_GAMES = [
  "Magic",
  "Pokemon",
  "Flesh and Blood",
  "Weiss Schwarz",
  "Riftbound",
];

function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(IMPORTS_DIR)) fs.mkdirSync(IMPORTS_DIR, { recursive: true });
}

function roundMoney(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 100) / 100;
}

function parseMoney(value) {
  if (value == null || value === "") return 0;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const cleaned = String(value).replace(/[$,\s]/g, "").replace(/[()]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function parseQty(value) {
  if (value == null || value === "") return 0;
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.round(value));
  const n = Number(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}

function normalizeHeader(h) {
  return String(h ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Excel serial or M/D/YY → YYYY-MM-DD */
export function parseSheetDate(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number" && value > 20000 && value < 80000) {
    const epoch = Date.UTC(1899, 11, 30);
    const d = new Date(epoch + Math.round(value) * 86400000);
    if (!Number.isFinite(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  }
  const s = String(value).trim();
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (mdy) {
    let year = Number(mdy[3]);
    if (year < 100) year += year >= 70 ? 1900 : 2000;
    const month = Number(mdy[1]);
    const day = Number(mdy[2]);
    const d = new Date(Date.UTC(year, month - 1, day));
    if (!Number.isFinite(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  }
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const t = Date.parse(s);
  if (Number.isFinite(t)) return new Date(t).toISOString().slice(0, 10);
  return null;
}

export function classifyTrackedGame(productName) {
  const name = String(productName || "");
  if (/weiss\s*schwarz|\bws\b|weiss/i.test(name)) return "Weiss Schwarz";
  if (/riftbound|league of legends|\bannie deck\b/i.test(name)) return "Riftbound";
  if (
    /flesh\s*and\s*blood|\bfab\b|arcane rising|heavy hitters|part the mistveil|rosetta|super slam|assassin|dynasty|history pack|bright lights|\bARC\b|\bHVY\b|\bMST\b/i.test(
      name
    )
  ) {
    return "Flesh and Blood";
  }
  if (
    /^magic\b|\bmtg\b|aetherdrift|duskmourn|edge of eternities|final fantasy|foundations|spider-man|universes beyond|modern horizons|tarkir|bloomburrow|lorwyn|innistrad|commander|outlaws of thunder|murders at|karlov|marvel|mh3|mh2|ub:|ub /i.test(
      name
    )
  ) {
    return "Magic";
  }
  if (
    /pok[eé]mon|\bsv[:\s]|scarlet|violet|prismatic|destined rivals|surging sparks|journey together|mega evolution|phantasmal|black bolt|white flare|eevee|temporal forces|obsidian flames|paldea|shrouded|stellar crown|paradox rift|crown zenith|lost origin|brilliant stars|evolving skies|fusion strike|vivid voltage|darkness ablaze|champions path|hidden fates|shining fates|celebrations|paldean fates|twilight masquerade|151 |ascended heroes|costco bundles/i.test(
      name
    )
  ) {
    return "Pokemon";
  }
  return null;
}

function findHeaderRowIndex(rows) {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const cells = (rows[i] || []).map(normalizeHeader);
    const hasItem = cells.some((c) => c === "item id" || c === "item name" || c === "product");
    const hasQty = cells.some((c) => c === "qty" || c === "quantity");
    if (hasItem && hasQty) return i;
  }
  return 0;
}

function mapColumns(headerRow) {
  const headers = headerRow.map(normalizeHeader);
  const find = (pred) => headers.findIndex(pred);

  const nameIdx = find((h) => h === "item id" || h === "product" || h === "product name" || h === "name");
  const qtyIdx = find((h) => h === "qty" || h === "quantity");
  const costIdx = find((h) => h.includes("cost") && (h.includes("tax") || h === "cost"));
  const typeIdx = find((h) => h === "type");
  const linkIdx = find((h) => h.includes("tcg") && h.includes("link"));
  const statusIdx = find((h) => h === "status");
  const soldUnitIdx = find((h) => h.startsWith("sold") && !h.includes("ttl") && !h.includes("total"));
  const soldTotalIdx = find(
    (h) => h.startsWith("sold") && (h.includes("ttl") || h.includes("total"))
  );
  const shippingIdx = find((h) => h.includes("shipping"));
  const feesIdx = find((h) => h === "fees" || h.startsWith("fees "));
  const netIdx = find((h) => h.includes("actual net") || h === "net");
  const dateIdx = find((h) => h === "date" || h.includes("sale date"));
  const retailIdx = find((h) => h.includes("last retail") || h === "retail");

  return {
    nameIdx: nameIdx >= 0 ? nameIdx : 0,
    qtyIdx: qtyIdx >= 0 ? qtyIdx : 3,
    costIdx: costIdx >= 0 ? costIdx : 4,
    typeIdx,
    linkIdx,
    statusIdx,
    soldUnitIdx,
    soldTotalIdx,
    shippingIdx,
    feesIdx,
    netIdx,
    dateIdx,
    retailIdx,
  };
}

function readSheetMatrix(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
  const workbook = xlsx.readFile(filePath, { raw: false, cellDates: false });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });
  return { sheetName, rows };
}

function parseInventoryFile(filePath, purchaseYear) {
  const { sheetName, rows } = readSheetMatrix(filePath);
  const headerRowIndex = findHeaderRowIndex(rows);
  const cols = mapColumns(rows[headerRowIndex] || []);
  const items = [];
  const dataRows = rows.slice(headerRowIndex + 1);

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i] || [];
    const productName = String(row[cols.nameIdx] ?? "").trim();
    if (!productName) continue;
    const quantity = parseQty(row[cols.qtyIdx]);
    const unitCost = parseMoney(row[cols.costIdx]);
    const itemType = cols.typeIdx >= 0 ? String(row[cols.typeIdx] ?? "").trim() : "";
    const linkRaw = cols.linkIdx >= 0 ? String(row[cols.linkIdx] ?? "").trim() : "";
    const status = cols.statusIdx >= 0 ? String(row[cols.statusIdx] ?? "").trim() : "";
    const lastRetail = cols.retailIdx >= 0 ? parseMoney(row[cols.retailIdx]) : 0;
    const game = classifyTrackedGame(productName);

    items.push({
      id: `y${purchaseYear}_row_${i}`,
      productName,
      normalizedName: normalizeName(productName),
      itemType,
      quantity,
      unitCost,
      purchaseYear: String(purchaseYear),
      game,
      sheetStatus: status || null,
      market: {
        soldMedian: null,
        activeLowest: null,
        lastSoldDate: null,
        tcgplayerMarket: lastRetail > 0 ? lastRetail : null,
        lastCheckedAt: null,
        lookupQuery: productName,
        overrideQuery: null,
        sheetProductUrl: linkRaw || null,
        sheetFallbackUsed: false,
        imageUrl: null,
      },
    });
  }

  return { sheetName, headerRowIndex, items, filePath };
}

function parseSoldFile(filePath, saleYear) {
  const { sheetName, rows } = readSheetMatrix(filePath);
  const headerRowIndex = findHeaderRowIndex(rows);
  const cols = mapColumns(rows[headerRowIndex] || []);
  const sales = [];
  const dataRows = rows.slice(headerRowIndex + 1);
  const y = String(saleYear);

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i] || [];
    const productName = String(row[cols.nameIdx] ?? "").trim();
    if (!productName) continue;

    const qty = parseQty(row[cols.qtyIdx]);
    const unitCost = parseMoney(row[cols.costIdx]);
    const soldUnit = cols.soldUnitIdx >= 0 ? parseMoney(row[cols.soldUnitIdx]) : 0;
    const soldTotalRaw = cols.soldTotalIdx >= 0 ? parseMoney(row[cols.soldTotalIdx]) : 0;
    const salePrice = roundMoney(soldTotalRaw > 0 ? soldTotalRaw : soldUnit * Math.max(qty, 1));
    const shipping = cols.shippingIdx >= 0 ? roundMoney(parseMoney(row[cols.shippingIdx])) : 0;
    const fees = cols.feesIdx >= 0 ? roundMoney(parseMoney(row[cols.feesIdx])) : 0;
    const actualNet = cols.netIdx >= 0 ? roundMoney(parseMoney(row[cols.netIdx])) : null;
    let saleDate = cols.dateIdx >= 0 ? parseSheetDate(row[cols.dateIdx]) : null;
    if (saleDate && saleDate.slice(0, 4) !== y) {
      // Keep the sheet date even if year mismatches; prefer file year for tax bucket.
    }
    if (!saleDate) saleDate = `${y}-12-31`;

    if (qty <= 0 && salePrice <= 0) continue;

    const game = classifyTrackedGame(productName);
    const gross = roundMoney(salePrice + shipping);
    const net = actualNet != null ? actualNet : roundMoney(gross - fees);
    const itemType = cols.typeIdx >= 0 ? String(row[cols.typeIdx] ?? "").trim() : "";

    sales.push({
      id: `sold_${y}_${i}`,
      orderNumber: `SHEET-${y}-${i + 1}`,
      saleDate,
      description: productName,
      buyerName: null,
      platform: "sheet",
      qty: Math.max(1, qty || 1),
      salePrice,
      shippingCost: shipping,
      feesPaid: fees,
      buyerTax: 0,
      grossReceipts: gross,
      netProceeds: net,
      status: "Sold",
      cogs: roundMoney(unitCost * Math.max(qty, 1)),
      notes: itemType ? `Type: ${itemType}` : "",
      source: "year_sheet",
      game,
      purchaseYearHint: null,
    });
  }

  sales.sort((a, b) => String(a.saleDate).localeCompare(String(b.saleDate)));
  return { sheetName, headerRowIndex, sales, filePath };
}

function toPurchaseLines(items, year) {
  return items
    .filter((it) => Number(it.quantity || 0) > 0 || Number(it.unitCost || 0) > 0)
    .map((it) => ({
      id: `purch_${year}_${it.id}`,
      description: it.productName,
      qty: Number(it.quantity || 0),
      unitCost: roundMoney(it.unitCost || 0),
      totalCost: roundMoney(Number(it.unitCost || 0) * Number(it.quantity || 0)),
      notes: [it.game, it.itemType, it.sheetStatus].filter(Boolean).join(" · "),
      source: "year_sheet_inventory",
    }));
}

/** Sold-sheet unit costs → purchase/COGS lines so Tax Prep COGS = beg + purch − end. */
function toSoldCogsPurchaseLines(sales, year) {
  return (sales || [])
    .filter((s) => Number(s.cogs || 0) > 0 || Number(s.qty || 0) > 0)
    .map((s, i) => {
      const qty = Math.max(1, Number(s.qty || 1));
      const totalCost = roundMoney(s.cogs || 0);
      const unitCost = qty > 0 ? roundMoney(totalCost / qty) : totalCost;
      return {
        id: `purch_sold_${year}_${i}`,
        description: s.description,
        qty,
        unitCost,
        totalCost,
        notes: `Sold ${s.saleDate || year} · sheet COGS`,
        source: "year_sheet_sold",
      };
    });
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  ensureDirs();
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function copyIntoImports(srcPath, destName) {
  ensureDirs();
  const dest = path.join(IMPORTS_DIR, destName);
  fs.copyFileSync(srcPath, dest);
  return dest;
}

/**
 * Import 2025/2026 inventory + sold CSVs into live inventory + Tax Prep.
 * Inventory sheets are current on-hand by purchase year; sold sheets are sales by year.
 */
export function importYearSheets({
  inventory2025Path,
  inventory2026Path,
  sold2025Path,
  sold2026Path,
  clearSalesLedger = true,
} = {}) {
  ensureDirs();

  const inv25Src = inventory2025Path;
  const inv26Src = inventory2026Path;
  const sold25Src = sold2025Path;
  const sold26Src = sold2026Path;

  if (!inv25Src || !fs.existsSync(inv25Src)) throw new Error("2025 inventory file is required");
  if (!inv26Src || !fs.existsSync(inv26Src)) throw new Error("2026 inventory file is required");
  if (!sold25Src || !fs.existsSync(sold25Src)) throw new Error("2025 sold file is required");
  if (!sold26Src || !fs.existsSync(sold26Src)) throw new Error("2026 sold file is required");

  const inv25Path = copyIntoImports(inv25Src, "Inventory25.csv");
  const inv26Path = copyIntoImports(inv26Src, "Inventory26.csv");
  const sold25Path = copyIntoImports(sold25Src, "Sold-2025.csv");
  const sold26Path = copyIntoImports(sold26Src, "Sold-2026.csv");

  const inv25 = parseInventoryFile(inv25Path, 2025);
  const inv26 = parseInventoryFile(inv26Path, 2026);
  const sold25 = parseSoldFile(sold25Path, 2025);
  const sold26 = parseSoldFile(sold26Path, 2026);

  const items = [...inv25.items, ...inv26.items];
  const importedAt = new Date().toISOString();
  const inventoryDb = readJson(INVENTORY_DB_PATH, {
    importedAt: null,
    sourceFilePath: null,
    settings: {},
    items: [],
  });

  inventoryDb.importedAt = importedAt;
  inventoryDb.sourceFilePath = `${inv25Path} + ${inv26Path}`;
  inventoryDb.sourceFiles = {
    inventory2025: inv25Path,
    inventory2026: inv26Path,
    sold2025: sold25Path,
    sold2026: sold26Path,
    importedAt,
  };
  inventoryDb.items = items;
  if (!Array.isArray(inventoryDb.importHistory)) inventoryDb.importHistory = [];
  inventoryDb.importHistory.unshift({
    importedAt,
    sourceFilePath: inventoryDb.sourceFilePath,
    itemCount: items.length,
    kind: "year_sheets",
  });
  writeJson(INVENTORY_DB_PATH, inventoryDb);
  appendProfitHistorySnapshot("year_sheets_import");

  const endingCombined = toPurchaseLines(items, "ending");
  const taxDb = readJson(TAX_PREP_DB_PATH, {
    priorInventoryByYear: {},
    purchasesByYear: {},
    endingInventoryByYear: {},
    expensesByYear: {},
    salesByYear: {},
  });
  if (!taxDb.purchasesByYear) taxDb.purchasesByYear = {};
  if (!taxDb.endingInventoryByYear) taxDb.endingInventoryByYear = {};
  if (!taxDb.salesByYear) taxDb.salesByYear = {};
  if (!taxDb.priorInventoryByYear) taxDb.priorInventoryByYear = {};

  // Purchases = remaining stock from that purchase-year sheet + COGS of items sold that year.
  // With ending 2025 = Inv25 and ending 2026 = Inv25+Inv26, COGS formula equals sold-sheet costs.
  taxDb.purchasesByYear["2025"] = [
    ...toPurchaseLines(inv25.items, 2025),
    ...toSoldCogsPurchaseLines(sold25.sales, 2025),
  ];
  taxDb.purchasesByYear["2026"] = [
    ...toPurchaseLines(inv26.items, 2026),
    ...toSoldCogsPurchaseLines(sold26.sales, 2026),
  ];
  taxDb.endingInventoryByYear["2026"] = endingCombined;
  // Stock still on hand that was purchased in 2025 (best stand-in for 2025 closing).
  taxDb.endingInventoryByYear["2025"] = toPurchaseLines(inv25.items, 2025);
  taxDb.salesByYear["2025"] = sold25.sales;
  taxDb.salesByYear["2026"] = sold26.sales;
  taxDb.lastYearSheetsImport = {
    importedAt,
    inventory2025: inv25Path,
    inventory2026: inv26Path,
    sold2025: sold25Path,
    sold2026: sold26Path,
    trackedGames: TRACKED_GAMES,
  };
  writeJson(TAX_PREP_DB_PATH, taxDb);

  if (clearSalesLedger) {
    writeJson(LEDGER_PATH, { allocations: [], clearedAt: importedAt, reason: "year_sheets_import" });
  }

  const sumCost = (list) => roundMoney(list.reduce((a, r) => a + Number(r.totalCost || 0), 0));
  const sumSales = (list) => roundMoney(list.reduce((a, r) => a + Number(r.salePrice || 0), 0));
  const units = (list) => list.reduce((a, r) => a + Number(r.quantity || r.qty || 0), 0);

  const purch25Inv = toPurchaseLines(inv25.items, 2025);
  const purch26Inv = toPurchaseLines(inv26.items, 2026);

  return {
    importedAt,
    trackedGames: TRACKED_GAMES,
    inventory: {
      itemCount: items.length,
      unitsOnHand: units(items),
      costOnHand: sumCost(endingCombined),
      from2025: { rows: inv25.items.length, units: units(inv25.items), cost: sumCost(purch25Inv) },
      from2026: { rows: inv26.items.length, units: units(inv26.items), cost: sumCost(purch26Inv) },
    },
    sales: {
      "2025": { rows: sold25.sales.length, productSales: sumSales(sold25.sales) },
      "2026": { rows: sold26.sales.length, productSales: sumSales(sold26.sales) },
    },
    paths: {
      inventory2025: inv25Path,
      inventory2026: inv26Path,
      sold2025: sold25Path,
      sold2026: sold26Path,
    },
  };
}
