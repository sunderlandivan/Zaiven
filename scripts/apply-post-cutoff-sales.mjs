import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { normalizeName } from "../server/inventoryAgent.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const CUTOFF = "2026-06-05";
const INVENTORY_PATH = path.join(ROOT, "data", "inventory-db.json");
const ORDERS_PATH = path.join(ROOT, "data", "orders-db.json");
const LEDGER_PATH = path.join(ROOT, "data", "inventory-sales-ledger.json");
const PREV_REPORT = path.join(ROOT, "data", "inventory-qty-adjust-report.json");

function scoreNameMatch(a, b) {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 100;
  if (na.includes(nb) || nb.includes(na)) return 80;
  const at = new Set(na.split(" ").filter((t) => t.length > 1));
  const bt = new Set(nb.split(" ").filter((t) => t.length > 1));
  if (!at.size || !bt.size) return 0;
  let common = 0;
  for (const t of at) if (bt.has(t)) common += 1;
  return Math.round((common / Math.max(at.size, bt.size)) * 70);
}

function findBest(description, items) {
  let best = null;
  let bestScore = 0;
  let second = 0;
  for (const item of items) {
    const score = Math.max(
      scoreNameMatch(description, item.productName),
      scoreNameMatch(description, item.normalizedName)
    );
    if (score > bestScore) {
      second = bestScore;
      bestScore = score;
      best = item;
    } else if (score > second) second = score;
  }
  return { item: best, score: bestScore, gap: bestScore - second };
}

function isConfident({ score, gap }) {
  return score >= 80 || (score >= 65 && gap >= 12);
}

function collapseLines(order) {
  const raw = Array.isArray(order.lineItems) ? order.lineItems : [];
  const byDesc = new Map();
  for (const li of raw) {
    let desc = String(li.description || "").trim();
    if (!desc || /\band\s+\d+\s+more\s+items?\b/i.test(desc)) continue;
    desc = desc.replace(/\/\s*Unopened.*/i, "").replace(/\($/, "").trim();
    const qty = Math.max(1, Number(li.quantity || 1));
    const key = desc.toLowerCase();
    const prev = byDesc.get(key);
    // Prefer a single line; if parser emitted 1 and 2 for same SKU, sum partials (true total).
    // Identical duplicate qty lines are ignored.
    if (!prev) byDesc.set(key, { description: desc, quantity: qty });
    else if (prev.quantity !== qty) byDesc.set(key, { description: desc, quantity: prev.quantity + qty });
  }
  if (!byDesc.size) {
    const name = String(order.productName || "").trim();
    if (name && !/^tcgplayer order /i.test(name) && !/\band\s+\d+\s+more\s+items?\b/i.test(name)) {
      byDesc.set(name.toLowerCase(), {
        description: name,
        quantity: Math.max(1, Number(order.quantity || 1)),
      });
    }
  }
  return [...byDesc.values()];
}

// Manual maps for known sealed SKUs that fuzzy match misses
const MANUAL = [
  { includes: ["unova poster"], itemIncludes: ["unova poster"] },
  { includes: ["phantasmal flames booster bundle"], itemIncludes: ["phantasmal flames", "booster bundle"] },
  { includes: ["astral radiance booster pack"], itemIncludes: ["astral radiance"] },
  { includes: ["mega evolution elite trainer box"], itemIncludes: ["mega evolution elite trainer box", "gardevoir"] },
];

function manualMatch(description, items) {
  const d = description.toLowerCase();
  for (const rule of MANUAL) {
    if (!rule.includes.every((p) => d.includes(p))) continue;
    const hit = items.find((it) => {
      const n = String(it.productName || "").toLowerCase();
      return rule.itemIncludes.every((p) => n.includes(p));
    });
    if (hit) return hit;
  }
  return null;
}

// 1) Restore qty from previous adjustment report (if present)
const inventory = JSON.parse(fs.readFileSync(INVENTORY_PATH, "utf8"));
const items = inventory.items || [];
if (fs.existsSync(PREV_REPORT)) {
  const prev = JSON.parse(fs.readFileSync(PREV_REPORT, "utf8"));
  for (const ch of prev.qtyChanges || []) {
    const item = items.find((i) => i.id === ch.itemId);
    if (item && Number.isFinite(Number(ch.before))) item.quantity = Number(ch.before);
  }
}

// 2) Collapse duplicate line items on post-cutoff orders
const ordersDb = JSON.parse(fs.readFileSync(ORDERS_PATH, "utf8"));
const orders = ordersDb.orders || [];
for (const order of orders) {
  if (!(String(order.purchaseDate || "").slice(0, 10) > CUTOFF)) continue;
  const lines = collapseLines(order);
  if (lines.length) {
    order.lineItems = lines;
    order.productName = lines[0].description;
    order.quantity = lines.reduce((a, li) => a + li.quantity, 0);
  }
}
fs.writeFileSync(ORDERS_PATH, JSON.stringify(ordersDb, null, 2));

const ordersAfter = orders.filter((o) => {
  const d = String(o.purchaseDate || "").slice(0, 10);
  return d > CUTOFF && !/cancel/i.test(String(o.status || ""));
});

const deductions = new Map();
const applied = [];
const unmatched = [];

function addDeduction(item, qty, meta) {
  const prev = deductions.get(item.id) || { qty: 0, name: item.productName };
  prev.qty += qty;
  deductions.set(item.id, prev);
  applied.push({ ...meta, itemId: item.id, itemName: item.productName });
}

for (const order of ordersAfter) {
  const lines = collapseLines(order);
  if (!lines.length) {
    unmatched.push({ orderNumber: order.orderNumber, date: order.purchaseDate, reason: "no product line" });
    continue;
  }
  for (const line of lines) {
    let item = manualMatch(line.description, items);
    let score = item ? 95 : 0;
    if (!item) {
      const match = findBest(line.description, items);
      if (match.item && isConfident(match)) {
        item = match.item;
        score = match.score;
      } else {
        unmatched.push({
          orderNumber: order.orderNumber,
          date: order.purchaseDate,
          description: line.description,
          qty: line.quantity,
          bestScore: match.score,
          bestName: match.item?.productName || null,
        });
        continue;
      }
    }
    addDeduction(item, line.quantity, {
      orderNumber: order.orderNumber,
      date: order.purchaseDate,
      description: line.description,
      qty: line.quantity,
      score,
    });
  }
}

const qtyChanges = [];
for (const [itemId, info] of deductions.entries()) {
  const item = items.find((i) => i.id === itemId);
  if (!item) continue;
  const before = Number(item.quantity || 0);
  const after = Math.max(0, before - info.qty);
  item.quantity = after;
  qtyChanges.push({ itemId, name: item.productName, soldQty: info.qty, before, after });
}

inventory.items = items;
fs.writeFileSync(INVENTORY_PATH, JSON.stringify(inventory, null, 2));

const ledger = fs.existsSync(LEDGER_PATH)
  ? JSON.parse(fs.readFileSync(LEDGER_PATH, "utf8"))
  : { allocations: [] };
const allocations = Array.isArray(ledger.allocations) ? [...ledger.allocations] : [];
for (const row of applied) {
  let found = allocations.find(
    (a) =>
      String(a.orderNumber).toUpperCase() === String(row.orderNumber).toUpperCase() &&
      normalizeName(a.description) === normalizeName(row.description)
  );
  if (!found) {
    allocations.push({
      id: `alloc_${row.orderNumber}_postcutoff`,
      orderNumber: row.orderNumber,
      lineIndex: 0,
      description: row.description,
      quantity: row.qty,
      saleDate: String(row.date || "").slice(0, 10),
      itemId: row.itemId,
      itemName: row.itemName,
      status: "matched",
      matchScore: row.score,
      matchedAt: new Date().toISOString(),
      matchSource: "post_cutoff_qty_adjust",
    });
  } else {
    found.itemId = row.itemId;
    found.itemName = row.itemName;
    found.quantity = row.qty;
    found.status = "matched";
    found.matchSource = "post_cutoff_qty_adjust";
    found.matchedAt = new Date().toISOString();
  }
}
fs.writeFileSync(LEDGER_PATH, JSON.stringify({ allocations }, null, 2));

const report = {
  cutoff: CUTOFF,
  note: "Sold CSV through 6/5 treated as already reflected in Excel. Portal qty reduced for matched orders after 6/5 only.",
  ordersAfterCutoff: ordersAfter.length,
  appliedLines: applied.length,
  unmatchedLines: unmatched.length,
  skusAdjusted: qtyChanges.length,
  unitsDeducted: qtyChanges.reduce((a, r) => a + r.soldQty, 0),
  qtyChanges: qtyChanges.sort((a, b) => b.soldQty - a.soldQty),
  applied,
  unmatched,
};
fs.writeFileSync(PREV_REPORT, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
