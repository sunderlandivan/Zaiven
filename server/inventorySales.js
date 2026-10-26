import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getInventoryDashboard, listOrders, normalizeName } from "./inventoryAgent.js";

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
const LEDGER_PATH = path.join(DATA_DIR, "inventory-sales-ledger.json");

function ensureLedger() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(LEDGER_PATH)) {
    fs.writeFileSync(LEDGER_PATH, JSON.stringify({ allocations: [] }, null, 2));
  }
}

function readLedger() {
  ensureLedger();
  return JSON.parse(fs.readFileSync(LEDGER_PATH, "utf8"));
}

function writeLedger(value) {
  ensureLedger();
  fs.writeFileSync(LEDGER_PATH, JSON.stringify(value, null, 2));
}

function allocationKey(orderNumber, lineIndex) {
  return `${String(orderNumber || "").toUpperCase()}::${Number(lineIndex)}`;
}

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
  const overlap = common / Math.max(at.size, bt.size);
  return Math.round(overlap * 70);
}

function orderLineItems(order) {
  const lines = Array.isArray(order?.lineItems) ? order.lineItems : [];
  if (lines.length) {
    return lines.map((li, idx) => ({
      lineIndex: idx,
      description: String(li.description || "").trim(),
      quantity: Math.max(1, Number(li.quantity || 1)),
    }));
  }
  const name = String(order?.productName || "").trim();
  if (name && !/^tcgplayer order /i.test(name)) {
    return [
      {
        lineIndex: 0,
        description: name,
        quantity: Math.max(1, Number(order.quantity || 1)),
      },
    ];
  }
  return [];
}

function findBestInventoryMatch(description, items) {
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
    } else if (score > second) {
      second = score;
    }
  }
  return { item: best, score: bestScore, secondScore: second, gap: bestScore - second };
}

function isHighConfidenceMatch({ score, gap }) {
  return score >= 80 || (score >= 70 && gap >= 15);
}

function saleTimestamp(order) {
  const d = String(order.purchaseDate || "").slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return `${d}T12:00:00.000Z`;
  return String(order.createdAt || order.lastEmailSyncAt || "");
}

function isSinceImport(order, importedAt) {
  if (!importedAt) return true;
  const saleAt = new Date(saleTimestamp(order)).getTime();
  const importMs = new Date(importedAt).getTime();
  if (!Number.isFinite(saleAt) || !Number.isFinite(importMs)) return true;
  return saleAt >= importMs;
}

/**
 * Ensure ledger rows exist for order line items and auto-match high-confidence SKUs.
 */
export function autoMatchSalesToInventory() {
  const dashboard = getInventoryDashboard();
  const items = Array.isArray(dashboard.items) ? dashboard.items : [];
  const orders = listOrders();
  const ledger = readLedger();
  const allocations = Array.isArray(ledger.allocations) ? [...ledger.allocations] : [];
  const byKey = new Map(allocations.map((a) => [allocationKey(a.orderNumber, a.lineIndex), a]));

  let created = 0;
  let autoMatched = 0;
  let needsMatch = 0;

  for (const order of orders) {
    const orderNumber = String(order.orderNumber || "").trim();
    if (!orderNumber) continue;
    if (/cancel/i.test(String(order.status || ""))) continue;
    const lines = orderLineItems(order);
    if (!lines.length) continue;

    for (const line of lines) {
      const key = allocationKey(orderNumber, line.lineIndex);
      let row = byKey.get(key);
      if (!row) {
        row = {
          id: `alloc_${orderNumber}_${line.lineIndex}`,
          orderNumber,
          lineIndex: line.lineIndex,
          description: line.description,
          quantity: line.quantity,
          saleDate: String(order.purchaseDate || "").slice(0, 10),
          itemId: null,
          itemName: null,
          status: "unmatched",
          matchScore: 0,
          matchedAt: null,
          matchSource: null,
        };
        byKey.set(key, row);
        created += 1;
      } else {
        row.description = line.description || row.description;
        row.quantity = line.quantity || row.quantity;
        row.saleDate = String(order.purchaseDate || row.saleDate || "").slice(0, 10);
      }

      if (row.status === "matched" && row.itemId) continue;
      if (row.status === "ignored") continue;

      const match = findBestInventoryMatch(row.description, items);
      if (match.item && isHighConfidenceMatch(match)) {
        row.itemId = match.item.id;
        row.itemName = match.item.productName;
        row.status = "matched";
        row.matchScore = match.score;
        row.matchedAt = new Date().toISOString();
        row.matchSource = "auto";
        autoMatched += 1;
      } else {
        row.status = "unmatched";
        row.itemId = null;
        row.itemName = null;
        row.matchScore = match.score || 0;
        row.matchSource = null;
        needsMatch += 1;
      }
    }
  }

  const next = [...byKey.values()];
  writeLedger({ allocations: next });
  return { created, autoMatched, needsMatch, total: next.length };
}

export function getSalesMatches() {
  autoMatchSalesToInventory();
  const ledger = readLedger();
  const allocations = Array.isArray(ledger.allocations) ? ledger.allocations : [];
  const unmatched = allocations.filter((a) => a.status === "unmatched");
  const matched = allocations.filter((a) => a.status === "matched");
  const ignored = allocations.filter((a) => a.status === "ignored");
  const dashboard = getInventoryDashboard();
  const itemOptions = (dashboard.items || []).map((it) => ({
    id: it.id,
    productName: it.productName,
    quantity: it.quantity,
  }));
  return { unmatched, matched, ignored, itemOptions };
}

export function confirmSalesMatch({ orderNumber, lineIndex, itemId, ignore = false }) {
  const ledger = readLedger();
  const allocations = Array.isArray(ledger.allocations) ? ledger.allocations : [];
  const key = allocationKey(orderNumber, lineIndex);
  const row = allocations.find((a) => allocationKey(a.orderNumber, a.lineIndex) === key);
  if (!row) throw new Error("Sale line not found in ledger. Run Gmail sync first.");

  if (ignore) {
    row.status = "ignored";
    row.itemId = null;
    row.itemName = null;
    row.matchSource = "manual";
    row.matchedAt = new Date().toISOString();
    writeLedger({ allocations });
    return row;
  }

  const dashboard = getInventoryDashboard();
  const item = (dashboard.items || []).find((it) => String(it.id) === String(itemId));
  if (!item) throw new Error("Inventory item not found.");

  row.itemId = item.id;
  row.itemName = item.productName;
  row.status = "matched";
  row.matchScore = 100;
  row.matchSource = "manual";
  row.matchedAt = new Date().toISOString();
  writeLedger({ allocations });
  return row;
}

function roundMoney(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 100) / 100;
}

export function getInventoryStockView() {
  const dashboard = getInventoryDashboard();
  const importedAt = dashboard.importedAt || null;
  autoMatchSalesToInventory();
  const ledger = readLedger();
  const allocations = Array.isArray(ledger.allocations) ? ledger.allocations : [];
  const orders = listOrders();
  const ordersByNumber = new Map(
    orders.map((o) => [String(o.orderNumber || "").toUpperCase(), o])
  );

  const soldByItem = new Map();
  for (const alloc of allocations) {
    if (alloc.status !== "matched" || !alloc.itemId) continue;
    const order = ordersByNumber.get(String(alloc.orderNumber || "").toUpperCase());
    if (order && !isSinceImport(order, importedAt)) continue;
    if (!order && importedAt && alloc.saleDate) {
      const saleMs = new Date(`${alloc.saleDate}T12:00:00.000Z`).getTime();
      const importMs = new Date(importedAt).getTime();
      if (Number.isFinite(saleMs) && Number.isFinite(importMs) && saleMs < importMs) continue;
    }
    const qty = Math.max(1, Number(alloc.quantity || 1));
    soldByItem.set(alloc.itemId, (soldByItem.get(alloc.itemId) || 0) + qty);
  }

  const items = (dashboard.items || []).map((item) => {
    const qtyExcel = Math.max(0, Number(item.quantity || 0));
    const soldSinceImport = soldByItem.get(item.id) || 0;
    const available = Math.max(0, qtyExcel - soldSinceImport);
    const unitCost = Number(item.unitCost || 0);
    const market = Number(item.metrics?.tcgplayerMarketPrice ?? item.metrics?.marketPrice ?? 0);
    const feePerUnit = Number(item.metrics?.bestFeePerUnit || 0);
    const profitPerUnit = Number(item.metrics?.bestProfitPerUnit);
    const totalInv = roundMoney(unitCost * available);
    const totalRetail = roundMoney(market * available);
    const profitTotal = Number.isFinite(profitPerUnit) ? roundMoney(profitPerUnit * available) : null;
    let status = "In stock";
    if (available <= 0 && qtyExcel <= 0) status = "Sold out";
    else if (available <= 0 && soldSinceImport > 0) status = "Sold since import";
    else if (item.workflow?.status === "listed") status = "Listed";
    else if (item.workflow?.status === "sold") status = "Marked sold";

    return {
      id: item.id,
      productName: item.productName,
      itemType: item.itemType || "",
      purchaseYear: item.purchaseYear || null,
      game: item.game || null,
      qtyExcel,
      soldSinceImport,
      available,
      unitCost,
      totalInv,
      lastRetail: Number.isFinite(market) && market > 0 ? market : null,
      totalRetail: market > 0 ? totalRetail : null,
      feePerUnit: Number.isFinite(feePerUnit) ? feePerUnit : null,
      profitPerUnit: Number.isFinite(profitPerUnit) ? profitPerUnit : null,
      profitTotal,
      marginPct: Number.isFinite(item.metrics?.bestMarginPct) ? item.metrics.bestMarginPct : null,
      status,
      tcgLink: item.market?.sheetProductUrl || item.metrics?.sourceUrl || item.market?.sourceUrl || null,
      imageUrl: item.metrics?.productImageUrl || item.market?.imageUrl || null,
    };
  });

  const summary = {
    importedAt,
    skuCount: items.length,
    unitsExcel: items.reduce((a, r) => a + r.qtyExcel, 0),
    unitsSoldSinceImport: items.reduce((a, r) => a + r.soldSinceImport, 0),
    unitsAvailable: items.reduce((a, r) => a + r.available, 0),
    grandTotalInv: roundMoney(items.reduce((a, r) => a + Number(r.totalInv || 0), 0)),
    retailTotal: roundMoney(items.reduce((a, r) => a + Number(r.totalRetail || 0), 0)),
    estProfit: roundMoney(items.reduce((a, r) => a + Number(r.profitTotal || 0), 0)),
    unmatchedSales: allocations.filter((a) => a.status === "unmatched").length,
  };

  return { items, summary, unmatched: allocations.filter((a) => a.status === "unmatched") };
}
