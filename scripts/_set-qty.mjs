import { readStockRows, readTab, getSheetSyncSettings } from "../server/sheetLedger.js";
import { productIdFromUrl } from "../server/tcgplayerCatalog.js";
import { batchUpdateValues, columnLetter } from "../server/googleSheets.js";
import { buildStoreCatalog } from "../server/storeCatalog.js";

const pid = String(process.argv[2] || "");
const want = Number(process.argv[3]);
if (!pid || !Number.isFinite(want)) {
  console.error("Usage: node scripts/_set-qty.mjs <productId> <qty>");
  process.exit(1);
}

const rows = (await readStockRows()).filter((r) => String(productIdFromUrl(r.link) || "") === pid);
if (!rows.length) {
  console.error("no rows for", pid);
  process.exit(1);
}
const total = rows.reduce((s, r) => s + (Number(r.qty) || 0), 0);
console.log({ pid, from: total, to: want, rows: rows.map((r) => ({ tab: r.tab, row: r.rowNumber, qty: r.qty })) });

const ordered = [...rows].sort((a, b) => {
  const ts = (t) => (t === "Inventory26" ? 0 : 1);
  if (ts(a.tab) !== ts(b.tab)) return ts(a.tab) - ts(b.tab);
  return (Number(b.qty) || 0) - (Number(a.qty) || 0);
});

let rem = want - total;
const { spreadsheetId } = getSheetSyncSettings();

if (rem > 0) {
  const r = ordered[0];
  const table = await readTab(r.tab);
  const newQty = (Number(r.qty) || 0) + rem;
  const cells = [{ range: `${columnLetter(table.cols.qty)}${r.rowNumber}`, values: [[newQty]] }];
  if (table.cols.status != null && /sold out/i.test(r.status || "")) {
    cells.push({ range: `${columnLetter(table.cols.status)}${r.rowNumber}`, values: [[""]] });
  }
  await batchUpdateValues(spreadsheetId, r.tab, cells);
  console.log("raised", r.tab, r.rowNumber, r.qty, "->", newQty);
} else if (rem < 0) {
  for (const r of ordered) {
    if (rem >= 0) break;
    const take = Math.min(Number(r.qty) || 0, -rem);
    if (!take) continue;
    const newQty = (Number(r.qty) || 0) - take;
    rem += take;
    const table = await readTab(r.tab);
    const cells = [{ range: `${columnLetter(table.cols.qty)}${r.rowNumber}`, values: [[newQty]] }];
    if (table.cols.status != null && newQty === 0) {
      cells.push({ range: `${columnLetter(table.cols.status)}${r.rowNumber}`, values: [["Sold out"]] });
    }
    await batchUpdateValues(spreadsheetId, r.tab, cells);
    console.log("lowered", r.tab, r.rowNumber, r.qty, "->", newQty);
  }
} else {
  console.log("noop");
}

await buildStoreCatalog({ dryRun: false });
console.log("catalog ok");
