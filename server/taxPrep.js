import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getInventoryDashboard, listOrders } from "./inventoryAgent.js";

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
const TAX_PREP_DB_PATH = path.join(DATA_DIR, "tax-prep-db.json");

const EXPENSE_CATEGORIES = [
  "subscription",
  "marketplace_fees",
  "office_supplies",
  "shipping",
  "software",
  "insurance",
  "other",
];

function ensureDataFiles() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(TAX_PREP_DB_PATH)) {
    fs.writeFileSync(
      TAX_PREP_DB_PATH,
      JSON.stringify(
        {
          priorInventoryByYear: {},
          purchasesByYear: {},
          endingInventoryByYear: {},
          expensesByYear: {},
          salesByYear: {},
        },
        null,
        2
      )
    );
  }
}

function readDb() {
  ensureDataFiles();
  return JSON.parse(fs.readFileSync(TAX_PREP_DB_PATH, "utf8"));
}

function writeDb(value) {
  ensureDataFiles();
  fs.writeFileSync(TAX_PREP_DB_PATH, JSON.stringify(value, null, 2));
}

function yearKey(year) {
  return String(Number(year) || new Date().getFullYear());
}

function roundMoney(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 100) / 100;
}

function lineTotal(qty, unitCost) {
  return roundMoney(Number(qty || 0) * Number(unitCost || 0));
}

function normalizeInventoryLine(input = {}) {
  const qty = Math.max(0, Number(input.qty ?? input.quantity ?? 0));
  const unitCost = roundMoney(input.unitCost ?? input.unit_cost ?? 0);
  return {
    id: String(input.id || `inv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`),
    description: String(input.description || input.productName || "").trim(),
    qty,
    unitCost,
    totalCost: roundMoney(input.totalCost ?? lineTotal(qty, unitCost)),
    notes: String(input.notes || "").trim(),
    source: String(input.source || "manual"),
  };
}

function normalizeExpense(input = {}) {
  const amount = roundMoney(input.amount ?? 0);
  const category = String(input.category || "other").toLowerCase();
  return {
    id: String(input.id || `exp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`),
    date: String(input.date || new Date().toISOString().slice(0, 10)),
    category: EXPENSE_CATEGORIES.includes(category) ? category : "other",
    vendor: String(input.vendor || "").trim(),
    description: String(input.description || "").trim(),
    amount,
    notes: String(input.notes || "").trim(),
  };
}

function inventoryLinesFromDashboard(dashboard) {
  const items = Array.isArray(dashboard?.items) ? dashboard.items : [];
  return items
    .filter((item) => Number(item.quantity || 0) > 0 || Number(item.unitCost || 0) > 0)
    .map((item) =>
      normalizeInventoryLine({
        id: `snap_${item.id}`,
        description: item.productName,
        qty: item.quantity,
        unitCost: item.unitCost,
        totalCost: roundMoney(Number(item.unitCost || 0) * Number(item.quantity || 0)),
        notes: "",
        source: "inventory_snapshot",
      })
    );
}

function orderInTaxYear(order, year) {
  const y = yearKey(year);
  const d = String(order.purchaseDate || order.createdAt || "").slice(0, 4);
  return d === y;
}

function isSaleOrder(order) {
  const status = String(order.status || "").toLowerCase();
  if (/cancel|refund|return|void/.test(status)) return false;
  const sale = Number(order.salePrice || order.orderAmount || 0);
  return sale > 0 || Boolean(order.orderNumber);
}

function salesLinesFromOrders(orders, year) {
  return orders
    .filter((o) => orderInTaxYear(o, year) && isSaleOrder(o))
    .map((o) => {
      const qty = Math.max(1, Number(o.quantity || 1));
      const salePrice = roundMoney(o.salePrice || 0);
      const shipping = roundMoney(o.shippingCost || 0);
      const fees = roundMoney(o.feeAmount || 0);
      const buyerTax = roundMoney(o.buyerTax || 0);
      const gross = roundMoney(o.orderAmount || salePrice + shipping + buyerTax);
      const net = roundMoney(gross - fees - shipping);
      return {
        id: String(o.id || o.orderNumber || ""),
        orderNumber: String(o.orderNumber || ""),
        saleDate: String(o.purchaseDate || "").slice(0, 10),
        description: String(o.productName || `Order ${o.orderNumber || ""}`).trim(),
        buyerName: o.buyerName || null,
        platform: String(o.platform || o.channel || "").trim() || null,
        qty,
        salePrice,
        shippingCost: shipping,
        feesPaid: fees,
        buyerTax,
        grossReceipts: gross,
        netProceeds: net,
        status: o.status || null,
        cogs: roundMoney(o.cogs || 0),
        notes: "",
        source: "orders",
      };
    })
    .sort((a, b) => String(a.saleDate).localeCompare(String(b.saleDate)));
}

function normalizeSalesLine(input = {}) {
  const qty = Math.max(1, Number(input.qty ?? input.quantity ?? 1));
  const salePrice = roundMoney(input.salePrice ?? 0);
  const shipping = roundMoney(input.shippingCost ?? input.shipping ?? 0);
  const fees = roundMoney(input.feesPaid ?? input.fees ?? 0);
  const buyerTax = roundMoney(input.buyerTax ?? 0);
  const gross = roundMoney(input.grossReceipts ?? salePrice + shipping + buyerTax);
  const net = roundMoney(input.netProceeds ?? gross - fees);
  return {
    id: String(input.id || `sale_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`),
    orderNumber: String(input.orderNumber || ""),
    saleDate: String(input.saleDate || "").slice(0, 10),
    description: String(input.description || input.productName || "").trim(),
    buyerName: input.buyerName || null,
    platform: String(input.platform || "").trim() || null,
    qty,
    salePrice,
    shippingCost: shipping,
    feesPaid: fees,
    buyerTax,
    grossReceipts: gross,
    netProceeds: net,
    status: input.status || null,
    cogs: roundMoney(input.cogs || 0),
    notes: String(input.notes || "").trim(),
    source: String(input.source || "manual"),
    game: input.game || null,
  };
}

function salesLinesForYear(db, orders, year) {
  const y = yearKey(year);
  const sheetSales = Array.isArray(db.salesByYear?.[y]) ? db.salesByYear[y] : [];
  if (sheetSales.length) {
    return sheetSales.map(normalizeSalesLine).sort((a, b) => String(a.saleDate).localeCompare(String(b.saleDate)));
  }
  return salesLinesFromOrders(orders, y);
}

function sumLines(lines, field) {
  return roundMoney(
    (Array.isArray(lines) ? lines : []).reduce((acc, row) => acc + Number(row[field] || 0), 0)
  );
}

export function getTaxPrepReport(year = new Date().getFullYear()) {
  const y = yearKey(year);
  const db = readDb();
  const dashboard = getInventoryDashboard();
  const orders = listOrders();

  const priorInventory = (db.priorInventoryByYear?.[y] || []).map(normalizeInventoryLine);
  const purchases = (db.purchasesByYear?.[y] || []).map(normalizeInventoryLine);
  let endingInventory = (db.endingInventoryByYear?.[y] || []).map(normalizeInventoryLine);
  if (!endingInventory.length) {
    endingInventory = inventoryLinesFromDashboard(dashboard);
  }
  const expenses = (db.expensesByYear?.[y] || []).map(normalizeExpense);
  const sales = salesLinesForYear(db, orders, y);
  const salesSource = Array.isArray(db.salesByYear?.[y]) && db.salesByYear[y].length ? "year_sheet" : "orders";

  const priorYear = String(Number(y) - 1);
  const priorYearClosing =
    (db.endingInventoryByYear?.[priorYear] || []).map(normalizeInventoryLine).length > 0
      ? (db.endingInventoryByYear[priorYear] || []).map(normalizeInventoryLine)
      : priorInventory;

  const totals = {
    priorInventoryCost: sumLines(priorYearClosing, "totalCost"),
    purchasesCost: sumLines(purchases, "totalCost"),
    endingInventoryCost: sumLines(endingInventory, "totalCost"),
    salesGross: sumLines(sales, "grossReceipts"),
    salesFees: sumLines(sales, "feesPaid"),
    salesShipping: sumLines(sales, "shippingCost"),
    salesNet: sumLines(sales, "netProceeds"),
    expensesTotal: sumLines(expenses, "amount"),
    estimatedCogs: roundMoney(
      sumLines(priorYearClosing, "totalCost") + sumLines(purchases, "totalCost") - sumLines(endingInventory, "totalCost")
    ),
  };

  return {
    year: y,
    priorYear,
    salesSource,
    priorInventory: priorYearClosing,
    purchases,
    endingInventory,
    sales,
    expenses,
    expenseCategories: EXPENSE_CATEGORIES,
    totals,
    generatedAt: new Date().toISOString(),
  };
}

export function saveTaxPrepSection(year, section, rows) {
  const y = yearKey(year);
  const db = readDb();
  if (!db.priorInventoryByYear) db.priorInventoryByYear = {};
  if (!db.purchasesByYear) db.purchasesByYear = {};
  if (!db.endingInventoryByYear) db.endingInventoryByYear = {};
  if (!db.expensesByYear) db.expensesByYear = {};
  if (!db.salesByYear) db.salesByYear = {};

  const list = Array.isArray(rows) ? rows : [];
  if (section === "priorInventory") {
    db.priorInventoryByYear[y] = list.map(normalizeInventoryLine);
  } else if (section === "purchases") {
    db.purchasesByYear[y] = list.map(normalizeInventoryLine);
  } else if (section === "endingInventory") {
    db.endingInventoryByYear[y] = list.map(normalizeInventoryLine);
  } else if (section === "expenses") {
    db.expensesByYear[y] = list.map(normalizeExpense);
  } else if (section === "sales") {
    db.salesByYear[y] = list.map(normalizeSalesLine);
  } else {
    throw new Error(`Unknown tax prep section: ${section}`);
  }
  writeDb(db);
  return getTaxPrepReport(y);
}

export function snapshotInventoryForTaxYear(year, target = "ending") {
  const y = yearKey(year);
  const dashboard = getInventoryDashboard();
  const lines = inventoryLinesFromDashboard(dashboard);
  const db = readDb();
  if (!db.priorInventoryByYear) db.priorInventoryByYear = {};
  if (!db.endingInventoryByYear) db.endingInventoryByYear = {};

  if (target === "prior") {
    db.priorInventoryByYear[y] = lines;
  } else {
    db.endingInventoryByYear[y] = lines;
  }
  writeDb(db);
  return getTaxPrepReport(y);
}
