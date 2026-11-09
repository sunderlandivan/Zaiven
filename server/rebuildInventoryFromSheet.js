import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getValues } from "./googleSheets.js";
import { getSheetSyncSettings } from "./sheetLedger.js";
import { importYearSheets } from "./yearSheetsImport.js";

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
const OUT_DIR = path.join(DATA_DIR, "imports");

function csvEscape(cell) {
  const s = String(cell ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function matrixToCsv(rows) {
  return rows.map((r) => (r || []).map(csvEscape).join(",")).join("\n") + "\n";
}

async function exportTab(spreadsheetId, tab, destName) {
  const values = await getValues(spreadsheetId, tab, "A1:AZ", "FORMATTED_VALUE");
  if (!values.length) throw new Error(`Tab "${tab}" returned no rows`);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const dest = path.join(OUT_DIR, destName);
  fs.writeFileSync(dest, matrixToCsv(values), "utf8");
  return dest;
}

/** Pull Inventory25/26 + Sold 2025/2026 from the live Sheet into inventory-db.json. */
export async function rebuildInventoryFromSheet({ clearSalesLedger = true } = {}) {
  const { spreadsheetId, stockTabs, purchaseTab } = getSheetSyncSettings();
  if (!spreadsheetId) throw new Error("Sheet sync spreadsheetId is not configured");

  const invTabs = [...new Set([...(stockTabs || []), purchaseTab].filter(Boolean))];
  if (!invTabs.includes("Inventory25") || !invTabs.includes("Inventory26")) {
    throw new Error(`Expected Inventory25 + Inventory26; got: ${invTabs.join(", ") || "(none)"}`);
  }

  const inventory2025Path = await exportTab(spreadsheetId, "Inventory25", "Inventory25.csv");
  const inventory2026Path = await exportTab(spreadsheetId, "Inventory26", "Inventory26.csv");
  const sold2025Path = await exportTab(spreadsheetId, "Sold 2025", "Sold-2025.csv");
  const sold2026Path = await exportTab(spreadsheetId, "Sold 2026", "Sold-2026.csv");

  return importYearSheets({
    inventory2025Path,
    inventory2026Path,
    sold2025Path,
    sold2026Path,
    clearSalesLedger,
  });
}
