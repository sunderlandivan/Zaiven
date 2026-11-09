import { readStockRows, readTab, getSheetSyncSettings } from "../server/sheetLedger.js";
import { productIdFromUrl } from "../server/tcgplayerCatalog.js";
import { batchUpdateValues, columnLetter } from "../server/googleSheets.js";
import { buildStoreCatalog } from "../server/storeCatalog.js";

async function updateCells(tab, cells) {
  const { spreadsheetId } = getSheetSyncSettings();
  await batchUpdateValues(
    spreadsheetId,
    tab,
    cells.map((c) => ({ range: c.a1, values: [[c.value]] }))
  );
}

async function setProductQty(pid, target, label) {
  const all = await readStockRows();
  const rows = all.filter((r) => String(productIdFromUrl(r.link) || "") === String(pid));
  if (!rows.length) return { label, pid, error: "no rows" };
  const total = rows.reduce((s, r) => s + (Number(r.qty) || 0), 0);
  if (total === target) return { label, pid, noop: true, total };
  const delta = target - total;
  const ordered = [...rows].sort((a, b) => {
    const tabScore = (t) => (t === "Inventory26" ? 0 : 1);
    if (tabScore(a.tab) !== tabScore(b.tab)) return tabScore(a.tab) - tabScore(b.tab);
    return (Number(b.qty) || 0) - (Number(a.qty) || 0);
  });
  const changes = [];
  if (delta > 0) {
    const r = ordered[0];
    const table = await readTab(r.tab);
    const newQty = (Number(r.qty) || 0) + delta;
    const cells = [{ a1: `${columnLetter(table.cols.qty)}${r.rowNumber}`, value: newQty }];
    if (table.cols.status != null && /sold out/i.test(r.status || "")) {
      cells.push({ a1: `${columnLetter(table.cols.status)}${r.rowNumber}`, value: "" });
    }
    await updateCells(r.tab, cells);
    changes.push({ tab: r.tab, row: r.rowNumber, from: r.qty, to: newQty });
  } else {
    let remaining = delta;
    for (const r of ordered) {
      if (remaining >= 0) break;
      const take = Math.min(Number(r.qty) || 0, -remaining);
      if (take <= 0) continue;
      const newQty = (Number(r.qty) || 0) - take;
      remaining += take;
      const table = await readTab(r.tab);
      const cells = [{ a1: `${columnLetter(table.cols.qty)}${r.rowNumber}`, value: newQty }];
      if (table.cols.status != null && newQty === 0) {
        cells.push({ a1: `${columnLetter(table.cols.status)}${r.rowNumber}`, value: "Sold out" });
      }
      await updateCells(r.tab, cells);
      changes.push({ tab: r.tab, row: r.rowNumber, from: r.qty, to: newQty });
    }
  }
  return { label, pid, from: total, to: target, changes };
}

const UPDATES = [
  [557241, 6, "Duskmourn Play Booster Display"],
  [668590, 7, "Pokemon Day 2026 Collection"],
  [475644, 2, "Morpeko V-UNION Playmat Premium Collection"],
  [656616, 4, "FINAL FANTASY Chocobo Bundle"],
  [541235, 6, "Bloomburrow Play Booster Display"],
  [675561, 6, "Secrets of Strixhaven Bundle"],
  [644300, 12, "Mega Evolution Enhanced Booster Box (2x6 cases)"],
  [648684, 5, "Avatar Bundle"],
  [675558, 6, "SOS Collector (inner 72 packs)"],
  [692983, 9, "Reality Fracture Collector (inner 6 + loose 3)"],
  [661934, 1, "Spiritforged Booster Display"],
  [635368, 13, "Riftbound Origins (7 loose + sealed case 6)"],
  [557354, 18, "Stellar Crown Booster Box (3x6 cases)"],
  [672401, 10, "Perfect Order ETB (two cartons of 5)"],
];

const dry = process.argv.includes("--dry");
const results = [];
for (const [pid, qty, label] of UPDATES) {
  if (dry) {
    const all = await readStockRows();
    const rows = all.filter((r) => String(productIdFromUrl(r.link) || "") === String(pid));
    const total = rows.reduce((s, r) => s + (Number(r.qty) || 0), 0);
    results.push({ label, pid, from: total, to: qty, dry: true, delta: qty - total });
    continue;
  }
  try {
    results.push(await setProductQty(pid, qty, label));
  } catch (e) {
    results.push({ label, pid, error: String(e.message || e) });
  }
}
console.log(JSON.stringify(results, null, 2));

if (!dry && !results.some((r) => r.error)) {
  console.log("Rebuilding store catalog...");
  await buildStoreCatalog({ dryRun: false });
  console.log("Catalog rebuilt.");
}
