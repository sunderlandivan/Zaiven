/**
 * Compare current Sheet stock qtys to physical-inventory baseline (pre Nov 3 count).
 * Cross-check Sold 2026 for units sold since baseline capture to separate sales vs true shortage.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { readStockRows, readTab } from "../server/sheetLedger.js";
import { productIdFromUrl } from "../server/tcgplayerCatalog.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE = JSON.parse(
  fs.readFileSync(path.join(ROOT, "data", "physical-inventory-baseline-pre-2026-11-03.json"), "utf8")
);

function pidOf(row) {
  return String(productIdFromUrl(row.link || row.Link || "") || "").trim();
}

const stock = await readStockRows();
const byPid = new Map();
for (const r of stock) {
  const pid = pidOf(r);
  if (!pid) continue;
  const cur = byPid.get(pid) || { pid, name: r.itemId || r.name, qty: 0, rows: [] };
  cur.qty += Number(r.qty) || 0;
  cur.name = cur.name || r.itemId;
  cur.rows.push({ tab: r.tab, row: r.rowNumber, qty: Number(r.qty) || 0, cost: Number(r.cost) || 0 });
  byPid.set(pid, cur);
}

// Sold 2026: sum qty by product id from link if present, else name match later
let soldRows = [];
try {
  const sold = await readTab("Sold 2026");
  soldRows = sold.rows || [];
} catch (e) {
  console.error("Sold 2026 read failed:", e.message || e);
}

const soldByPid = new Map();
const soldByName = new Map();
for (const r of soldRows) {
  const qty = Number(r.qty) || 0;
  if (!qty) continue;
  const date = String(r.date || r.Date || "").trim();
  // Count all 2026 sales — baseline was early Nov 3; sales after that explain some drops.
  // Also include late Oct if date parseable; for shortage audit we mainly care post-baseline.
  const pid = pidOf(r);
  const name = String(r.itemId || r.name || "").trim();
  if (pid) soldByPid.set(pid, (soldByPid.get(pid) || 0) + qty);
  if (name) soldByName.set(name.toLowerCase(), (soldByName.get(name.toLowerCase()) || 0) + qty);
}

const changes = [];
const seen = new Set();

for (const b of BASELINE.items || []) {
  const pid = String(b.pid || "");
  seen.add(pid);
  const after = byPid.get(pid)?.qty ?? 0;
  const before = Number(b.qty) || 0;
  const delta = after - before;
  if (delta === 0) continue;
  const soldQty = soldByPid.get(pid) || 0;
  // unexplained shortage: sheet went down more than sold (approx). Sales can also be from older stock not in baseline.
  const unexplained = delta < 0 ? Math.min(0, delta + soldQty) : 0;
  changes.push({
    pid,
    name: b.name,
    before,
    after,
    delta,
    sold2026Qty: soldQty,
    unexplainedShortage: unexplained < 0 ? -unexplained : 0,
  });
}

// New pids on sheet not in baseline (with qty > 0)
const newPids = [];
for (const [pid, cur] of byPid) {
  if (seen.has(pid)) continue;
  if (cur.qty <= 0) continue;
  newPids.push({ pid, name: cur.name, before: 0, after: cur.qty, delta: cur.qty });
}

changes.sort((a, b) => a.delta - b.delta || a.name.localeCompare(b.name));
newPids.sort((a, b) => b.delta - a.delta || a.name.localeCompare(b.name));

const lowered = changes.filter((c) => c.delta < 0);
const raised = changes.filter((c) => c.delta > 0);
const shortages = lowered
  .map((c) => ({
    ...c,
    // true soft shortage = drop not covered by Sold 2026 qty on that pid
    softShortage: Math.max(0, -c.delta - (c.sold2026Qty || 0)),
  }))
  .filter((c) => c.softShortage > 0)
  .sort((a, b) => b.softShortage - a.softShortage || a.delta - b.delta);

const out = {
  comparedAt: new Date().toISOString(),
  baselineNote: BASELINE.note,
  baselineItemCount: BASELINE.itemCount,
  summary: {
    changedSkus: changes.length,
    raised: raised.length,
    lowered: lowered.length,
    softShortageSkus: shortages.length,
    softShortageUnits: shortages.reduce((s, c) => s + c.softShortage, 0),
    newPidCount: newPids.length,
  },
  softShortages: shortages,
  lowered,
  raised,
  newPids,
};

const outPath = path.join(ROOT, "data", "physical-inventory-diff-live.json");
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(JSON.stringify({ summary: out.summary, softShortages: shortages.slice(0, 40), topLowered: lowered.slice(0, 25), topRaised: raised.slice(-15).reverse() }, null, 2));
console.log("Wrote", outPath);
