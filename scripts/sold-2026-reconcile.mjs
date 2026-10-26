// Read-only: matches every 2026 order (TCGplayer, eBay, website) to Sold 2026 rows and writes
// data/sold-2026-recon.json (matches, orders missing from the sheet, rows with no order).
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { findBestRow, readStockRows, readTab, scoreItemMatch, getSheetSyncSettings } from "../server/sheetLedger.js";
import { readWebOrders } from "../server/webOrders.js";
import { isCancelledOrder, isPaidOrder } from "../server/manualOrders.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));
const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const JUNK = new Set(["E402B8AB-C0FB7C-073D4"]);

// ---------- source orders ----------
const ordersDb = readJson("data/orders-db.json").orders;
const dbByNo = new Map(ordersDb.map((o) => [o.orderNumber, o]));
const labels = readJson("data/shipping-labels.json").labels || [];

function labelCostFor(orderNumber) {
  const db = dbByNo.get(orderNumber);
  if (db?.labelCost != null) return r2(db.labelCost);
  const hits = labels.filter((l) => l.orderNumber === orderNumber && l.status !== "dismissed");
  return hits.length ? r2(hits.reduce((s, l) => s + Number(l.cost || 0), 0)) : null;
}

const cleanTcgName = (n) => String(n).replace(/\s+-\s+Unopened$/i, "").trim();

const tcg = readJson("data/imports/tcgplayer-orders-2026-detail.json").orders
  .filter((o) => !JUNK.has(o.orderNumber))
  .map((o) => {
    const db = dbByNo.get(o.orderNumber) || {};
    const refund = r2((o.refunds || []).reduce((s, r) => s + Number(r.amount || 0), 0));
    const tax = r2((o.t.taxes || []).reduce((s, t) => s + Number(t.amount || 0), 0));
    return {
      channel: "TCGplayer",
      orderNumber: o.orderNumber,
      date: new Date(o.createdAt).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" }),
      status: o.status,
      canceled: /cancel/i.test(o.status),
      product: r2(o.t.productAmount),
      shipping: r2(o.t.shippingAmount),
      fees: r2(db.feesActual ?? o.t.feeAmount),
      feesPortal: r2(o.t.feeAmount),
      feeBasis: "actual",
      marketTax: tax,
      ourTax: 0,
      refund,
      refundType: refund ? (/cancel/i.test(o.status) ? "full" : "partial") : "",
      labelCost: labelCostFor(o.orderNumber),
      shipState: o.shipState || "",
      lines: o.products.map((p) => ({ description: cleanTcgName(p.name), qty: p.quantity, unitPrice: r2(p.unitPrice), ext: r2(p.extendedPrice), productId: p.productId })),
    };
  });

const ebay = readJson("data/imports/ebay-orders-2026-detail.json").orders.map((o) => ({
  channel: "eBay",
  orderNumber: o.orderNumber,
  date: o.soldDate,
  status: o.status,
  canceled: o.status === "Canceled",
  product: r2(o.subtotal),
  shipping: r2(o.shipping),
  fees: r2(o.transactionFees + o.adFee),
  feeBasis: "actual",
  feeDetail: { transaction: o.transactionFees, promotedListing: o.adFee },
  marketTax: r2(o.ebayCollectedTax + o.retailDeliveryFee),
  ourTax: 0,
  refund: r2(o.status === "Canceled" ? o.subtotal + o.shipping : o.buyerRefund - o.ebayPaidRefund),
  refundType: o.status === "Canceled" ? "full" : o.buyerRefund ? "partial" : "",
  labelCost: o.status === "Canceled" ? 0 : r2(o.labelCost),
  shipState: o.shipState,
  lines: o.items.map((i) => ({ description: i.title, qty: i.qty, unitPrice: r2(i.price), ext: r2(i.price * i.qty) })),
}));

const web = readWebOrders()
  .filter((o) => !o.test && (isPaidOrder(o) || isCancelledOrder(o)))
  .map((o) => ({
    channel: o.channel && o.channel !== "Website" ? `Website/${o.channel} (${o.paymentMethod})` : `Website (${o.paymentMethod || "paypal"})`,
    orderNumber: o.id,
    date: new Date(o.paidAt || o.createdAt).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" }),
    status: o.status,
    canceled: isCancelledOrder(o) || !isPaidOrder(o),
    product: r2(o.subtotal ?? o.lines.reduce((s, l) => s + l.price * l.qty, 0)),
    shipping: r2(o.shipping),
    fees: r2(o.paymentFee ?? o.paypalFee ?? 0),
    feeBasis: "actual",
    marketTax: 0,
    ourTax: r2(o.tax || 0),
    refund: r2(o.refund || 0),
    refundType: o.refund ? "partial" : "",
    labelCost: o.shippingCost != null ? r2(o.shippingCost) : null,
    shipState: o.shipTo?.address?.admin_area_1 || "",
    lines: o.lines.map((l) => ({ description: l.single ? l.name : l.title, qty: l.qty, unitPrice: r2(l.price), ext: r2(l.price * l.qty), webLineId: l.id, single: Boolean(l.single) })),
  }));

const allOrders = [...tcg, ...ebay, ...web].filter((o) => o.date >= "2026-01-01");

// ---------- sheet rows ----------
const settings = getSheetSyncSettings();
const sold = await readTab(settings.soldTab);
const { getValues } = await import("../server/googleSheets.js");
const raw = await getValues(settings.spreadsheetId, settings.soldTab, "A1:AZ", "UNFORMATTED_VALUE");
const header = raw[sold.headerRowNumber - 1] || [];
const sheetRows = sold.rows.map((r) => {
  const v = raw[r.rowNumber - 1] || [];
  const at = (i) => (i == null ? undefined : v[i]);
  const dk = String(r.date || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return {
    rowNumber: r.rowNumber,
    itemId: r.itemId,
    type: r.type,
    qty: r.qty,
    cost: r.cost,
    unit: Number(at(sold.cols.soldUnit)) || 0,
    total: Number(at(sold.cols.soldTotal)) || 0,
    shipping: Number(at(sold.cols.shipping)) || 0,
    fees: Number(at(sold.cols.fees)) || 0,
    date: dk ? `${dk[3]}-${dk[1].padStart(2, "0")}-${dk[2].padStart(2, "0")}` : String(r.date || ""),
    sheetDate: r.date,
    orderNo: sold.cols.orderNumber != null ? String(at(sold.cols.orderNumber) || "") : "",
  };
});

const dayDiff = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 86400000);
const near = (a, b, tol = 0.02) => Math.abs(a - b) <= tol;
const isEbayRow = (r) => /^ebay\b/i.test(r.itemId);
const nameScore = (o, r) => Math.max(...o.lines.map((l) => scoreItemMatch(l.description, r.itemId)), 0);

const used = new Set();
const matches = [];
function take(order, rows, how) {
  for (const r of rows) used.add(r.rowNumber);
  matches.push({ orderNumber: order.orderNumber, channel: order.channel, canceled: order.canceled, rows: rows.map((r) => r.rowNumber), how });
  order.matched = true;
}

// Rows already carrying an order number (from earlier annotation) match directly.
for (const o of allOrders) {
  const rows = sheetRows.filter((r) => r.orderNo.split(/[,\s]+/).includes(o.orderNumber));
  if (rows.length) take(o, rows, "order-number column");
}

const pool = (o, { ebayRows }) =>
  sheetRows.filter((r) => !used.has(r.rowNumber) && (ebayRows === null || isEbayRow(r) === ebayRows) && Math.abs(dayDiff(r.date, o.date)) <= 75);

// Hand-checked pairings where owner rows carry different prices/shipping/dates than the order (row numbers as of 2026-10-12).
const MANUAL = {
  "14-14373-92507": [54],
  "02-14295-39405": [16],
  "01-14366-23449": [39],
  "13-14398-12078": [53],
  "DC5D041D-11635F-F1787": [5],
  "DC5D041D-6261DF-4F04D": [18],
  "DC5D041D-EC0DB2-DF72E": [43],
  "DC5D041D-660A54-715C6": [107],
  "DC5D041D-0AD0B1-C7351": [106],
  "DC5D041D-CDBE12-78E23": [26],
  "DC5D041D-76D24D-D5659": [25],
};
// Orders only partly on the sheet: the unlogged quantity gets its own row.
const PARTIAL = { "DC5D041D-6261DF-4F04D": { qty: 1, note: "Row 18 logged 1 of the 2 units in this order; this row adds the 2nd unit." } };
// Owner batch rows for the late-June/early-July Marvel singles (rows 84 + 90).
const AGG_ROWS = [84, 90];
const AGG_FROM = "2026-06-26";
const AGG_TO = "2026-07-07";

for (const o of allOrders) {
  const rows = MANUAL[o.orderNumber];
  if (rows && !o.matched) take(o, rows.map((n) => sheetRows.find((r) => r.rowNumber === n)), "manual review");
}

function passExact(o, opts, minName = 0) {
  if (o.canceled) minName = Math.max(minName, 40);
  const c = pool(o, opts)
    .filter((r) => near(r.total, o.product) && near(r.shipping, o.shipping) && nameScore(o, r) >= minName)
    .sort((a, b) => nameScore(o, b) - nameScore(o, a) || Math.abs(dayDiff(a.date, o.date)) - Math.abs(dayDiff(b.date, o.date)));
  if (c.length) return take(o, [c[0]], "price+shipping"), true;
  return false;
}
const passExactNamed = (o, opts) => passExact(o, opts, 40);

function passMulti(o, opts) {
  if (o.lines.length < 2) return false;
  const c = pool(o, opts).filter((r) => r.total > 0 && r.total <= o.product + 0.02);
  const byDate = new Map();
  for (const r of c) byDate.set(r.date, [...(byDate.get(r.date) || []), r]);
  for (const rows of byDate.values()) {
    const n = Math.min(rows.length, 14);
    for (let mask = 1; mask < 1 << n; mask++) {
      const set = rows.slice(0, n).filter((_, i) => mask & (1 << i));
      if (set.length < 2 || set.length > o.lines.length) continue;
      const tot = set.reduce((s, r) => s + r.total, 0);
      const ship = set.reduce((s, r) => s + r.shipping, 0);
      if (near(tot, o.product, 0.03) && near(ship, o.shipping, 0.03)) return take(o, set, "multi-line price+shipping"), true;
    }
  }
  return false;
}

function passPriceName(o, opts, minName = 45) {
  if (o.canceled) return false;
  const c = pool(o, opts)
    .filter((r) => near(r.total, o.product, 0.05) || near(r.total, o.product + o.shipping, 0.05) || near(r.total + r.shipping, o.product + o.shipping, 0.05))
    .map((r) => ({ r, s: nameScore(o, r) }))
    .filter((x) => x.s >= minName)
    .sort((a, b) => b.s - a.s);
  if (c.length) return take(o, [c[0].r], `price+name(${c[0].s})`), true;
  return false;
}

function passName(o, opts, minName = 70) {
  if (o.canceled) return false;
  const c = pool(o, opts)
    .filter((r) => r.total > 0 && Math.abs(r.total - o.product) <= Math.max(1, o.product * 0.1))
    .map((r) => ({ r, s: nameScore(o, r) }))
    .filter((x) => x.s >= minName)
    .sort((a, b) => b.s - a.s);
  if (c.length) return take(o, [c[0].r], `name+approx price(${c[0].s})`), true;
  return false;
}

const byChannel = (ch) => allOrders.filter((o) => o.channel.startsWith(ch) && !o.matched && !o.canceled);
for (const step of [passExactNamed, passMulti, passExact, passPriceName, passName]) {
  for (const o of byChannel("eBay")) if (!o.matched) step(o, { ebayRows: null });
  for (const o of byChannel("Website")) if (!o.matched) step(o, { ebayRows: false });
  for (const o of byChannel("TCGplayer")) if (!o.matched) step(o, { ebayRows: false });
}
// Canceled orders only claim a leftover row of the same item (a sale logged before the cancel).
for (const o of allOrders.filter((x) => x.canceled && !x.matched)) passExact(o, { ebayRows: o.channel === "eBay" ? null : false }, 40);

// ---------- costs ----------
const stockRows = await readStockRows();
const lc = (s) => String(s || "").trim().toLowerCase();
function costFor(line, channel) {
  if (channel === "eBay") return { note: "eBay custom deck/accessory; no sheet cost row" };
  const m = findBestRow(line.description, stockRows, { productId: line.productId ? Number(line.productId) : null });
  if (!m.row || !(m.confident || m.viaListing || m.viaAlias)) return { note: "no confident stock-row match (single card or unlisted item)" };
  const same = stockRows.filter((r) => lc(r.itemId) === lc(m.row.itemId));
  const highest = Math.max(...same.map((r) => Number(r.cost) || 0));
  return { itemId: m.row.itemId, tab: m.row.tab, code: m.row.code, type: m.row.type, actualCost: r2(m.row.cost), highestCost: r2(highest) };
}

const aggregates = [];
const aggOrders = allOrders.filter(
  (o) => o.channel === "TCGplayer" && !o.matched && !o.canceled && o.date >= AGG_FROM && o.date <= AGG_TO && o.lines.every((l) => /#\s?\d|near mint|played|foil/i.test(l.description)),
);
if (aggOrders.length) {
  for (const n of AGG_ROWS) used.add(n);
  for (const o of aggOrders) {
    o.matched = true;
    matches.push({ orderNumber: o.orderNumber, channel: o.channel, canceled: false, rows: AGG_ROWS, how: "owner aggregate rows" });
  }
  aggregates.push({ rows: AGG_ROWS, orders: aggOrders.map((o) => o.orderNumber), product: r2(aggOrders.reduce((s, o) => s + o.product, 0)), shipping: r2(aggOrders.reduce((s, o) => s + o.shipping, 0)) });
}

const missing = allOrders.filter((o) => !o.matched && !o.canceled);
for (const o of missing) for (const l of o.lines) l.cost = costFor(l, o.channel);
// Partial-refund and every order keep their numbers; matched orders get annotation data too.
for (const o of allOrders.filter((x) => x.matched && !x.canceled)) for (const l of o.lines) l.cost = costFor(l, o.channel);

const unmatchedRows = sheetRows.filter((r) => !used.has(r.rowNumber));
const out = {
  builtAt: new Date().toISOString(),
  header,
  cols: sold.cols,
  sheetRowCount: sheetRows.length,
  orders: allOrders,
  matches,
  aggregates,
  partial: PARTIAL,
  missing: missing.map((o) => o.orderNumber),
  canceledOrders: allOrders.filter((o) => o.canceled).map((o) => ({ orderNumber: o.orderNumber, channel: o.channel, date: o.date, amount: r2(o.product + o.shipping), matchedRows: matches.find((m) => m.orderNumber === o.orderNumber)?.rows || [] })),
  unmatchedRows,
  sheetRows,
};
fs.writeFileSync(path.join(ROOT, "data", "sold-2026-recon.json"), JSON.stringify(out, null, 1));

const cnt = (ch) => allOrders.filter((o) => o.channel.startsWith(ch));
for (const ch of ["TCGplayer", "eBay", "Website"]) {
  const os = cnt(ch);
  console.log(ch, "orders", os.length, "canceled", os.filter((o) => o.canceled).length, "matched", os.filter((o) => o.matched && !o.canceled).length, "missing", os.filter((o) => !o.matched && !o.canceled).length);
}
console.log("sheet rows", sheetRows.length, "unmatched rows", unmatchedRows.length);
console.log("hows", matches.reduce((a, m) => ((a[m.how.replace(/\(.*/, "")] = (a[m.how.replace(/\(.*/, "")] || 0) + 1), a), {}));
console.log("--- missing");
for (const o of missing) console.log(o.channel, o.orderNumber, o.date, o.product, o.shipping, o.lines.map((l) => `${l.qty}x ${l.description.slice(0, 50)}`).join("; "));
console.log("--- unmatched rows");
for (const r of unmatchedRows) console.log(r.rowNumber, r.date, r.qty, r.itemId.slice(0, 60), r.total, r.shipping, r.fees);
console.log("--- canceled");
for (const c of out.canceledOrders) console.log(c.channel, c.orderNumber, c.date, c.amount, "rows", c.matchedRows.join(","));
console.log("--- fuzzy matches");
for (const m of matches.filter((m) => !/^price\+shipping|order-number/.test(m.how))) {
  const o = allOrders.find((x) => x.orderNumber === m.orderNumber);
  console.log(m.how, m.orderNumber, o.date, o.product, o.shipping, o.lines[0].description.slice(0, 40), "=>", m.rows.map((n) => { const r = sheetRows.find((x) => x.rowNumber === n); return `${n}:${r.itemId.slice(0, 35)}|${r.total}|${r.shipping}|${r.date}`; }).join(" ; "));
}
