// Read-only ports of the PC portal's report builders (server/inventoryAgent.js, inventorySales.js, taxPrep.js, loan.js,
// salesTaxReport.js, emailIntake.js), computed from the D1 docs. Nothing here writes.
import { readDoc } from "./docs.js";
import { readWebOrders, isCancelledOrder, isPaidOrder } from "./orders.js";
import { getSheetSettings } from "./sheet.js";

const round2 = (n) => {
  const x = Number(n);
  return Number.isFinite(x) ? Math.round(x * 100) / 100 : 0;
};

export function paginate(list, { page, pageSize } = {}) {
  if (!pageSize) return { items: list, page: 1, pageSize: list.length, total: list.length };
  const size = Math.min(200, Math.max(1, Number(pageSize) || 50));
  const p = Math.max(1, Number(page) || 1);
  return { items: list.slice((p - 1) * size, p * size), page: p, pageSize: size, total: list.length };
}

// ---------- inventory dashboard (Selling Analytics, Dashboard Analytics) ----------

const DEFAULT_SETTINGS = { feeProfiles: { tcgplayer: { percentFee: 0.1275, fixedFee: 0.3 }, ebay: { percentFee: 0.1325, fixedFee: 0.3 } }, defaultShippingCost: 0 };

function tcgplayerHref(href) {
  const t = String(href || "").trim();
  if (!t) return null;
  if (t.startsWith("/")) return `https://www.tcgplayer.com${t}`;
  try {
    const u = new URL(t.startsWith("//") ? `https:${t}` : t);
    return u.hostname.toLowerCase().endsWith("tcgplayer.com") ? u.toString() : null;
  } catch {
    return null;
  }
}
const tcgplayerSearch = (q) => `https://www.tcgplayer.com/search/all/product?q=${encodeURIComponent(String(q || "").trim() || "tcg")}`;

function evaluateItem(item, settings) {
  const signals = item.market || {};
  const market = signals.tcgplayerMarket ?? null;
  const shippingCost = Number(settings.defaultShippingCost || 0);
  const costBasis = Number(item.unitCost || 0);
  const profile = settings.feeProfiles.tcgplayer;
  const known = Number.isFinite(market) && market > 0;
  const fee = known ? market * profile.percentFee + profile.fixedFee : 0;
  const net = known ? market - fee - shippingCost : 0;
  const profit = known ? net - costBasis : null;
  const margin = known ? (profit / market) * 100 : null;
  const best = { salePrice: known ? market : null, feeAmount: fee, netAfterFees: net, profit, marginPct: margin };
  const query = signals.lookupQueryUsed ?? signals.lookupQuery ?? item.productName;
  return {
    ...item,
    metrics: {
      marketPrice: best.salePrice ?? market ?? null,
      marketPriceKnown: known,
      tcgplayerMarketPrice: market,
      sourceUrl: tcgplayerHref(signals.sheetProductUrl || signals.sourceUrl) || tcgplayerSearch(query),
      sourceQuery: query,
      sourceLabel: market ? (signals.sheetFallbackUsed ? "TCGplayer (Excel link)" : "TCGplayer (search)") : "No TCG match",
      productImageUrl: signals.imageUrl || null,
      tcgplayer: best,
      bestPlatform: "tcgplayer",
      bestProfitPerUnit: profit,
      bestMarginPct: margin,
      totalBestProfit: Number.isFinite(profit) ? profit * item.quantity : null,
      bestFeePerUnit: Number.isFinite(fee) ? fee : null,
      bestNetAfterFeesPerUnit: Number.isFinite(net) ? net : null,
      totalEstimatedFees: fee * item.quantity,
      totalEstimatedNetAfterFees: net * item.quantity,
      totalCostBasis: costBasis * item.quantity,
      totalEstimatedMarketValue: known ? market * item.quantity : null,
    },
  };
}

export async function inventoryDashboard(env) {
  const [db, workflowDb, history] = await Promise.all([
    readDoc(env, "inventory-db", { items: [] }),
    readDoc(env, "inventory-workflow-db", { items: {} }),
    readDoc(env, "inventory-profit-history", { snapshots: [] }),
  ]);
  const settings = db?.settings || DEFAULT_SETTINGS;
  const items = (db?.items || []).map((item) => ({ ...evaluateItem(item, settings), workflow: workflowDb?.items?.[item.id] || null }));
  const totals = { units: 0, costBasis: 0, marketValue: 0, bestProfit: 0, profitWinnersOnly: 0, profitLosersOnly: 0, pricedItems: 0 };
  for (const item of items) {
    const p = Number.isFinite(Number(item.metrics.totalBestProfit)) ? Number(item.metrics.totalBestProfit) : 0;
    totals.units += item.quantity;
    totals.costBasis += item.unitCost * item.quantity;
    totals.marketValue += (item.metrics.marketPrice || 0) * item.quantity;
    totals.bestProfit += p;
    if (p > 0) totals.profitWinnersOnly += p;
    if (p < 0) totals.profitLosersOnly += p;
    if (item.metrics.marketPriceKnown) totals.pricedItems += 1;
  }
  return { importedAt: db?.importedAt || null, totals, items, settings, profitHistory: history?.snapshots || [] };
}

// ---------- Inventory page (stock view + needs-match) ----------

function saleTimestamp(order) {
  const d = String(order.purchaseDate || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T12:00:00.000Z` : String(order.createdAt || order.lastEmailSyncAt || "");
}

/** Same numbers as the PC's getInventoryStockView, using the ledger as last matched on the PC (auto-match runs there). */
export async function stockView(env) {
  const [dashboard, ledger, ordersDb] = await Promise.all([
    inventoryDashboard(env),
    readDoc(env, "inventory-sales-ledger", { allocations: [] }),
    readDoc(env, "orders-db", { orders: [] }),
  ]);
  const importMs = new Date(dashboard.importedAt || 0).getTime();
  const allocations = ledger?.allocations || [];
  const byNumber = new Map((ordersDb?.orders || []).map((o) => [String(o.orderNumber || "").toUpperCase(), o]));
  const sold = new Map();
  for (const a of allocations) {
    if (a.status !== "matched" || !a.itemId) continue;
    const order = byNumber.get(String(a.orderNumber || "").toUpperCase());
    const saleMs = new Date(order ? saleTimestamp(order) : `${a.saleDate}T12:00:00.000Z`).getTime();
    if (dashboard.importedAt && Number.isFinite(saleMs) && Number.isFinite(importMs) && saleMs < importMs) continue;
    sold.set(a.itemId, (sold.get(a.itemId) || 0) + Math.max(1, Number(a.quantity || 1)));
  }
  const items = dashboard.items.map((item) => {
    const qtyExcel = Math.max(0, Number(item.quantity || 0));
    const soldSinceImport = sold.get(item.id) || 0;
    const available = Math.max(0, qtyExcel - soldSinceImport);
    const unitCost = Number(item.unitCost || 0);
    const market = Number(item.metrics?.tcgplayerMarketPrice ?? item.metrics?.marketPrice ?? 0);
    const profitPerUnit = Number(item.metrics?.bestProfitPerUnit);
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
      totalInv: round2(unitCost * available),
      lastRetail: market > 0 ? market : null,
      totalRetail: market > 0 ? round2(market * available) : null,
      feePerUnit: Number.isFinite(item.metrics?.bestFeePerUnit) ? item.metrics.bestFeePerUnit : null,
      profitPerUnit: Number.isFinite(profitPerUnit) ? profitPerUnit : null,
      profitTotal: Number.isFinite(profitPerUnit) ? round2(profitPerUnit * available) : null,
      marginPct: Number.isFinite(item.metrics?.bestMarginPct) ? item.metrics.bestMarginPct : null,
      status,
      tcgLink: item.market?.sheetProductUrl || item.metrics?.sourceUrl || null,
      imageUrl: item.metrics?.productImageUrl || null,
    };
  });
  const unmatched = allocations.filter((a) => a.status === "unmatched");
  const sum = (k) => round2(items.reduce((a, r) => a + Number(r[k] || 0), 0));
  return {
    items,
    unmatched,
    itemOptions: dashboard.items.map((it) => ({ id: it.id, productName: it.productName, quantity: it.quantity })),
    summary: {
      importedAt: dashboard.importedAt,
      skuCount: items.length,
      unitsExcel: items.reduce((a, r) => a + r.qtyExcel, 0),
      unitsSoldSinceImport: items.reduce((a, r) => a + r.soldSinceImport, 0),
      unitsAvailable: items.reduce((a, r) => a + r.available, 0),
      grandTotalInv: sum("totalInv"),
      retailTotal: sum("totalRetail"),
      estProfit: sum("profitTotal"),
      unmatchedSales: unmatched.length,
    },
  };
}

// ---------- Tax Prep ----------

const EXPENSE_CATEGORIES = ["subscription", "marketplace_fees", "office_supplies", "shipping", "software", "insurance", "other"];

const invLine = (x = {}) => {
  const qty = Math.max(0, Number(x.qty ?? x.quantity ?? 0));
  const unitCost = round2(x.unitCost ?? 0);
  return { id: String(x.id || ""), description: String(x.description || x.productName || "").trim(), qty, unitCost, totalCost: round2(x.totalCost ?? qty * unitCost), notes: String(x.notes || ""), source: String(x.source || "manual") };
};
const expenseLine = (x = {}) => ({
  id: String(x.id || ""),
  date: String(x.date || ""),
  category: EXPENSE_CATEGORIES.includes(String(x.category).toLowerCase()) ? String(x.category).toLowerCase() : "other",
  vendor: String(x.vendor || ""),
  description: String(x.description || ""),
  amount: round2(x.amount ?? 0),
  notes: String(x.notes || ""),
});
function saleLine(x = {}) {
  const salePrice = round2(x.salePrice ?? 0);
  const shippingCost = round2(x.shippingCost ?? x.shipping ?? 0);
  const feesPaid = round2(x.feesPaid ?? x.fees ?? 0);
  const buyerTax = round2(x.buyerTax ?? 0);
  const grossReceipts = round2(x.grossReceipts ?? salePrice + shippingCost + buyerTax);
  return {
    id: String(x.id || ""),
    orderNumber: String(x.orderNumber || ""),
    saleDate: String(x.saleDate || "").slice(0, 10),
    description: String(x.description || x.productName || "").trim(),
    buyerName: x.buyerName || null,
    platform: String(x.platform || "").trim() || null,
    qty: Math.max(1, Number(x.qty ?? x.quantity ?? 1)),
    salePrice,
    shippingCost,
    feesPaid,
    buyerTax,
    grossReceipts,
    netProceeds: round2(x.netProceeds ?? grossReceipts - feesPaid),
    status: x.status || null,
    cogs: round2(x.cogs || 0),
    notes: String(x.notes || ""),
    source: String(x.source || "manual"),
    game: x.game || null,
  };
}
function salesFromOrders(orders, y) {
  return orders
    .filter((o) => String(o.purchaseDate || o.createdAt || "").slice(0, 4) === y && !/cancel|refund|return|void/i.test(String(o.status || "")) && (Number(o.salePrice || o.orderAmount || 0) > 0 || o.orderNumber))
    .map((o) => {
      const shipping = round2(o.shippingCost || 0);
      const fees = round2(o.feeAmount || 0);
      const gross = round2(o.orderAmount || Number(o.salePrice || 0) + shipping + Number(o.buyerTax || 0));
      return saleLine({ ...o, id: o.id || o.orderNumber, saleDate: o.purchaseDate, description: o.productName || `Order ${o.orderNumber || ""}`, platform: o.platform || o.channel, qty: o.quantity, shippingCost: shipping, feesPaid: fees, grossReceipts: gross, netProceeds: round2(gross - fees - shipping), source: "orders" });
    });
}
const sumOf = (lines, k) => round2(lines.reduce((a, r) => a + Number(r[k] || 0), 0));

export async function taxPrepReport(env, year) {
  const y = String(Number(year) || new Date().getFullYear());
  const [db, ordersDb] = await Promise.all([readDoc(env, "tax-prep-db", {}), readDoc(env, "orders-db", { orders: [] })]);
  const prior = String(Number(y) - 1);
  const purchases = (db?.purchasesByYear?.[y] || []).map(invLine);
  let endingInventory = (db?.endingInventoryByYear?.[y] || []).map(invLine);
  if (!endingInventory.length) {
    const dash = await inventoryDashboard(env);
    endingInventory = dash.items
      .filter((i) => Number(i.quantity || 0) > 0 || Number(i.unitCost || 0) > 0)
      .map((i) => invLine({ id: `snap_${i.id}`, description: i.productName, qty: i.quantity, unitCost: i.unitCost, source: "inventory_snapshot" }));
  }
  const priorClosing = (db?.endingInventoryByYear?.[prior] || []).length ? db.endingInventoryByYear[prior].map(invLine) : (db?.priorInventoryByYear?.[y] || []).map(invLine);
  const sheetSales = db?.salesByYear?.[y] || [];
  const sales = (sheetSales.length ? sheetSales.map(saleLine) : salesFromOrders(ordersDb?.orders || [], y)).sort((a, b) => a.saleDate.localeCompare(b.saleDate));
  const expenses = (db?.expensesByYear?.[y] || []).map(expenseLine);
  return {
    year: y,
    priorYear: prior,
    salesSource: sheetSales.length ? "year_sheet" : "orders",
    priorInventory: priorClosing,
    purchases,
    endingInventory,
    sales,
    expenses,
    expenseCategories: EXPENSE_CATEGORIES,
    totals: {
      priorInventoryCost: sumOf(priorClosing, "totalCost"),
      purchasesCost: sumOf(purchases, "totalCost"),
      endingInventoryCost: sumOf(endingInventory, "totalCost"),
      salesGross: sumOf(sales, "grossReceipts"),
      salesFees: sumOf(sales, "feesPaid"),
      salesShipping: sumOf(sales, "shippingCost"),
      salesNet: sumOf(sales, "netProceeds"),
      expensesTotal: sumOf(expenses, "amount"),
      estimatedCogs: round2(sumOf(priorClosing, "totalCost") + sumOf(purchases, "totalCost") - sumOf(endingInventory, "totalCost")),
    },
    generatedAt: new Date().toISOString(),
  };
}

// ---------- Loan ----------

export async function loanReport(env) {
  const db = (await readDoc(env, "loan-db", {})) || {};
  const totalLoanAmount = round2(db.totalLoanAmount || 0);
  const payments = [...(db.payments || [])].sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.id).localeCompare(String(b.id)));
  const totalPaid = round2(payments.reduce((a, p) => a + Number(p.amount || 0), 0));
  const remaining = round2(totalLoanAmount + totalPaid);
  const opt = (v) => (v == null || v === "" ? null : round2(v));
  let cumulative = 0;
  const history = payments.map((p) => {
    cumulative = round2(cumulative + Number(p.amount || 0));
    return { ...p, amountAbs: round2(Math.abs(Number(p.amount || 0))), cumulativePaid: round2(Math.abs(cumulative)), balanceAfter: round2(totalLoanAmount + cumulative) };
  });
  const byMonth = new Map();
  for (const p of payments) byMonth.set(String(p.date).slice(0, 7), round2((byMonth.get(String(p.date).slice(0, 7)) || 0) + Math.abs(Number(p.amount || 0))));
  return {
    totalLoanAmount,
    totalPaid,
    totalPaidAbs: round2(Math.abs(totalPaid)),
    remaining,
    payoffPct: totalLoanAmount > 0 ? round2((Math.abs(totalPaid) / totalLoanAmount) * 100) : 0,
    currentInBank: opt(db.currentInBank),
    pendingPayment: opt(db.pendingPayment),
    totalIncomingBanked: round2((opt(db.currentInBank) || 0) + (opt(db.pendingPayment) || 0)),
    notes: String(db.notes || ""),
    updatedAt: db.updatedAt || null,
    paymentCount: payments.length,
    payments: history,
    charts: {
      payoffSplit: [
        { label: "Paid", value: round2(Math.abs(totalPaid)) },
        { label: "Remaining", value: Math.max(0, remaining) },
      ],
      cumulative: history.map((h) => ({ date: h.date, cumulativePaid: h.cumulativePaid, remaining: h.balanceAfter })),
      byMonth: [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([month, paid]) => ({ month, paid })),
    },
  };
}

// ---------- California sales tax (website orders) ----------

const localDate = (iso) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
const blankMonth = (month) => ({ month, orders: 0, totalSales: 0, outOfStateSales: 0, caOrders: 0, caMerchandise: 0, caShipping: 0, caTaxableSales: 0, taxCollected: 0, caUntaxedOrders: 0, caUntaxedSales: 0, districts: {} });
const orderState = (o) => String(o.shipTo?.address?.admin_area_1 || "").toUpperCase();

function addSale(b, o) {
  const subtotal = Number(o.subtotal || 0);
  const shipping = Number(o.shipping || 0);
  const tax = Number(o.tax || 0);
  b.orders += 1;
  b.totalSales += subtotal + shipping;
  if (orderState(o) !== "CA") {
    b.outOfStateSales += subtotal + shipping;
    return;
  }
  const taxable = o.taxInfo ? Number(o.taxInfo.taxable || 0) : subtotal;
  b.caOrders += 1;
  b.caMerchandise += subtotal;
  b.caShipping += shipping;
  b.caTaxableSales += taxable;
  b.taxCollected += tax;
  if (!tax) {
    b.caUntaxedOrders += 1;
    b.caUntaxedSales += taxable;
  }
  for (const d of o.taxInfo?.districts || []) {
    const row = (b.districts[d.name] ||= { rate: d.rate, taxableSales: 0, tax: 0 });
    row.taxableSales += taxable;
    row.tax += taxable * d.rate;
  }
}
function finishMonth(b) {
  for (const k of Object.keys(b)) if (typeof b[k] === "number" && k !== "orders" && !/Orders$/.test(k)) b[k] = round2(b[k]);
  for (const d of Object.values(b.districts)) Object.assign(d, { taxableSales: round2(d.taxableSales), tax: round2(d.tax) });
  return b;
}

export async function salesTaxReport(env, { from = "", to = "" } = {}) {
  const orders = (await readWebOrders(env))
    .filter((o) => isPaidOrder(o) && !isCancelledOrder(o) && !o.test)
    .map((o) => ({ o, date: localDate(o.paidAt || o.createdAt) }))
    .filter(({ date }) => (!from || date >= from) && (!to || date <= to))
    .sort((a, b) => a.date.localeCompare(b.date));
  const months = new Map();
  const total = blankMonth("total");
  for (const { o, date } of orders) {
    const key = date.slice(0, 7);
    if (!months.has(key)) months.set(key, blankMonth(key));
    addSale(months.get(key), o);
    addSale(total, o);
  }
  return {
    from,
    to,
    months: [...months.values()].map(finishMonth),
    total: finishMonth(total),
    orders: orders
      .filter(({ o }) => orderState(o) === "CA")
      .map(({ o, date }) => ({ id: o.id, date, zip: o.shipTo?.address?.postal_code || "", subtotal: Number(o.subtotal || 0), shipping: Number(o.shipping || 0), taxable: o.taxInfo ? Number(o.taxInfo.taxable || 0) : Number(o.subtotal || 0), rate: o.taxInfo?.rate || 0, tax: Number(o.tax || 0), districts: (o.taxInfo?.districts || []).map((d) => d.name) })),
  };
}

const csvCell = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
export function salesTaxCsv(report) {
  const districts = [...new Set([...report.months, report.total].flatMap((m) => Object.keys(m.districts)))];
  const head = ["Month", "Orders", "Total sales (excl. tax)", "Out-of-state sales", "CA orders", "CA merchandise", "CA shipping charged", "CA taxable sales", "Sales tax collected", "CA orders without tax", "CA sales without tax", ...districts.map((n) => `Taxable sales: ${n}`)];
  const row = (m) => [m.month, m.orders, m.totalSales, m.outOfStateSales, m.caOrders, m.caMerchandise, m.caShipping, m.caTaxableSales, m.taxCollected, m.caUntaxedOrders, m.caUntaxedSales, ...districts.map((n) => m.districts[n]?.taxableSales || 0)];
  return [head, ...report.months.map(row), row(report.total)].map((r) => r.map(csvCell).join(",")).join("\n");
}

// ---------- Sheet Sync (PC page shape) and Sold 2026 ----------

export async function sheetSyncState(env) {
  const [queue, settings, meta] = await Promise.all([readDoc(env, "sheet-sync-queue", {}), getSheetSettings(env), readDoc(env, "sheet-snapshot-meta", null)]);
  const events = [...(queue?.events || [])].sort((a, b) => String(b.createdAt || b.date).localeCompare(String(a.createdAt || a.date)));
  return {
    settings: { enabled: false, intervalMinutes: "—", ...settings },
    gmail: { connected: true, sheetsAccess: Boolean(meta), cloud: true },
    lastRun: queue?.lastRun || null,
    lastCloudRun: queue?.lastCloudRun || null,
    running: false,
    needsReview: events.filter((e) => ["needs_review", "error", "ready"].includes(e.status)),
    recent: events.filter((e) => e.status === "applied" || e.status === "ignored").slice(0, 100),
    mirror: meta,
  };
}

export async function sheetSyncHealth(env) {
  const queue = (await readDoc(env, "sheet-sync-queue", {})) || {};
  return { enabled: false, reviewCount: (queue.events || []).filter((e) => e.status === "needs_review" || e.status === "error").length, loginProblem: false, lastRunAt: queue.lastRun?.at || null };
}

export async function sheetRows(env, tab) {
  const snap = await readDoc(env, "sheet-snapshot", null);
  if (!snap) return { at: null, rows: [] };
  const tabs = tab ? [snap.tabs[tab]].filter(Boolean) : Object.values(snap.tabs);
  return { at: snap.at, rows: tabs.flatMap((t) => t.rows) };
}
