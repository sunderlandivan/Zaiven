/**
 * YTD Schedule C inputs for 2026 from the order data in data/sold-2026-recon.json (run sold-2026-reconcile.mjs first)
 * plus the live Sold 2026 / Inventory26 tabs. Writes data/sold-2026-ytd.json; docs/sold-2026-ytd.md is written from it.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readTab } from "../server/sheetLedger.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const recon = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "sold-2026-recon.json"), "utf8"));
const taxPrep = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "tax-prep-db.json"), "utf8"));
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const blank = () => ({ orders: 0, product: 0, shipping: 0, gross: 0, refunds: 0, fees: 0, feesEstimated: 0, marketTax: 0, ourTax: 0, labels: 0, labelOrders: 0 });
const add = (t, o) => {
  t.orders += 1;
  t.product += o.product;
  t.shipping += o.shipping;
  t.gross += o.product + o.shipping;
  t.refunds += o.refund || 0;
  t.fees += o.fees || 0;
  if (o.feeBasis !== "actual") t.feesEstimated += o.fees || 0;
  t.marketTax += o.marketTax || 0;
  t.ourTax += o.ourTax || 0;
  if (o.labelCost != null) { t.labels += Number(o.labelCost); t.labelOrders += 1; }
};
const round = (t) => Object.fromEntries(Object.entries(t).map(([k, v]) => [k, typeof v === "number" ? r2(v) : v]));

const live = recon.orders.filter((o) => !o.canceled);
const canceled = recon.orders.filter((o) => o.canceled);
const byChannel = {};
const byMonth = {};
const total = blank();
for (const o of live) {
  add((byChannel[o.channel] ||= blank()), o);
  add((byMonth[o.date.slice(0, 7)] ||= blank()), o);
  add(total, o);
}
const canceledFees = r2(canceled.reduce((s, o) => s + (o.fees || 0), 0));

// Per-sale COGS: specific identification (cost of the stock row the item came from) vs highest-cost baseline.
let actual = 0, highest = 0, costedLines = 0;
const noCost = [];
const differs = [];
for (const o of live) {
  for (const l of o.lines) {
    const c = l.cost || {};
    if (c.actualCost == null) { noCost.push({ order: o.orderNumber, channel: o.channel, item: l.description, qty: l.qty, sale: l.ext, why: c.note || "" }); continue; }
    costedLines += 1;
    actual += c.actualCost * l.qty;
    highest += c.highestCost * l.qty;
    if (Math.abs(c.highestCost - c.actualCost) > 0.005) differs.push({ item: c.itemId, qty: l.qty, actual: c.actualCost, highest: c.highestCost });
  }
}

const sold = await readTab("Sold 2026");
const sheet = sold.rows.reduce((t, r) => {
  const qty = Number(r.qty) || 0;
  t.rows += 1;
  t.cost += (Number(r.cost) || 0) * qty;
  t.product += (Number(r.soldUnit) || 0) * qty;
  t.shipping += Number(r.shipping) || 0;
  t.fees += Number(r.fees) || 0;
  if (r.cost === "" || r.cost == null) t.blankCost += 1;
  return t;
}, { rows: 0, cost: 0, product: 0, shipping: 0, fees: 0, blankCost: 0 });

const inv26 = await readTab("Inventory26");
const purchasesTab = inv26.rows.reduce((s, r) => s + (Number(r.qty) || 0) * (Number(r.cost) || 0), 0);
const sumList = (list) => r2((list || []).reduce((s, x) => s + (Number(x.totalCost) || 0), 0));

const unmatched = recon.unmatchedRows.map((r) => ({ row: r.rowNumber, item: r.itemId, qty: r.qty, total: r.total, shipping: r.shipping, date: r.date }));

const out = JSON.stringify({
  total: round(total),
  byChannel: Object.fromEntries(Object.entries(byChannel).map(([k, v]) => [k, round(v)])),
  byMonth: Object.fromEntries(Object.entries(byMonth).sort().map(([k, v]) => [k, round(v)])),
  canceled: canceled.map((o) => ({ channel: o.channel, order: o.orderNumber, date: o.date, amount: r2(o.product + o.shipping), fees: o.fees })),
  canceledFees,
  partialRefunds: live.filter((o) => o.refund).map((o) => ({ channel: o.channel, order: o.orderNumber, refund: o.refund })),
  cogs: { actual: r2(actual), highest: r2(highest), costedLines, noCostLines: noCost.length, noCostSales: r2(noCost.reduce((s, x) => s + x.sale, 0)), differs },
  noCostByChannel: noCost.reduce((m, x) => ((m[x.channel] = (m[x.channel] || 0) + 1), m), {}),
  noCostNonSingles: noCost.filter((x) => !/#\s?\d|near mint|played|foil/i.test(x.item)),
  sheet: round(sheet),
  inventory: {
    beginning2026Snapshot: sumList(taxPrep.priorInventoryByYear?.["2026"]),
    ending2025Import: sumList(taxPrep.endingInventoryByYear?.["2025"]),
    purchases2026Import: sumList(taxPrep.purchasesByYear?.["2026"]),
    purchases2026Tab: r2(purchasesTab),
    inventory26Rows: inv26.rows.length,
    importedAt: taxPrep.lastYearSheetsImport?.importedAt,
  },
  unmatched,
}, null, 1);
fs.writeFileSync(path.join(ROOT, "data", "sold-2026-ytd.json"), out);
console.log(out);
