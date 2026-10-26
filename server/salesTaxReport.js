import { readWebOrders } from "./webOrders.js";
import { isCancelledOrder, isPaidOrder } from "./manualOrders.js";

// Website sales by month for the CDTFA sales and use tax return. Tax collected is a liability, never income:
// "totalSales" (return line 1) is merchandise + shipping without the tax, as the Sold sheet records it.

const round2 = (n) => Math.round(n * 100) / 100;
const localDate = (iso) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });

function blank(key) {
  return {
    month: key,
    orders: 0,
    totalSales: 0,
    outOfStateSales: 0,
    caOrders: 0,
    caMerchandise: 0,
    caShipping: 0,
    caTaxableSales: 0,
    taxCollected: 0,
    caUntaxedOrders: 0,
    caUntaxedSales: 0,
    districts: {},
  };
}

function add(bucket, o) {
  const state = String(o.shipTo?.address?.admin_area_1 || "").toUpperCase();
  const subtotal = Number(o.subtotal || 0);
  const shipping = Number(o.shipping || 0);
  const tax = Number(o.tax || 0);
  bucket.orders += 1;
  bucket.totalSales += subtotal + shipping;
  if (state !== "CA") {
    bucket.outOfStateSales += subtotal + shipping;
    return;
  }
  bucket.caOrders += 1;
  bucket.caMerchandise += subtotal;
  bucket.caShipping += shipping;
  const taxable = o.taxInfo ? Number(o.taxInfo.taxable || 0) : subtotal;
  bucket.caTaxableSales += taxable;
  bucket.taxCollected += tax;
  // Orders from before tax collection started: CA tax is still owed on them by the seller.
  if (!tax) {
    bucket.caUntaxedOrders += 1;
    bucket.caUntaxedSales += taxable;
  }
  for (const d of o.taxInfo?.districts || []) {
    const row = (bucket.districts[d.name] ||= { rate: d.rate, taxableSales: 0, tax: 0 });
    row.taxableSales += taxable;
    row.tax += taxable * d.rate;
  }
}

function finish(b) {
  for (const k of Object.keys(b)) if (typeof b[k] === "number" && k !== "orders" && !/Orders$/.test(k)) b[k] = round2(b[k]);
  for (const d of Object.values(b.districts)) {
    d.taxableSales = round2(d.taxableSales);
    d.tax = round2(d.tax);
  }
  return b;
}

/** from/to: YYYY-MM-DD (inclusive, Pacific time). Paid, non-test, non-cancelled website orders only. */
export function salesTaxReport({ from = "", to = "" } = {}) {
  const orders = readWebOrders()
    .filter((o) => isPaidOrder(o) && !isCancelledOrder(o) && !o.test)
    .map((o) => ({ o, date: localDate(o.paidAt || o.createdAt) }))
    .filter(({ date }) => (!from || date >= from) && (!to || date <= to))
    .sort((a, b) => a.date.localeCompare(b.date));

  const months = new Map();
  const total = blank("total");
  for (const { o, date } of orders) {
    const key = date.slice(0, 7);
    if (!months.has(key)) months.set(key, blank(key));
    add(months.get(key), o);
    add(total, o);
  }
  return {
    from,
    to,
    months: [...months.values()].map(finish),
    total: finish(total),
    orders: orders
      .filter(({ o }) => String(o.shipTo?.address?.admin_area_1 || "").toUpperCase() === "CA")
      .map(({ o, date }) => ({
        id: o.id,
        date,
        zip: o.shipTo?.address?.postal_code || "",
        subtotal: Number(o.subtotal || 0),
        shipping: Number(o.shipping || 0),
        taxable: o.taxInfo ? Number(o.taxInfo.taxable || 0) : Number(o.subtotal || 0),
        rate: o.taxInfo?.rate || 0,
        tax: Number(o.tax || 0),
        districts: (o.taxInfo?.districts || []).map((d) => d.name),
      })),
  };
}

const csvCell = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

export function salesTaxCsv(report) {
  const districtNames = [...new Set([...report.months, report.total].flatMap((m) => Object.keys(m.districts)))];
  const head = [
    "Month",
    "Orders",
    "Total sales (excl. tax)",
    "Out-of-state sales",
    "CA orders",
    "CA merchandise",
    "CA shipping charged",
    "CA taxable sales",
    "Sales tax collected",
    "CA orders without tax",
    "CA sales without tax",
    ...districtNames.map((n) => `Taxable sales: ${n}`),
  ];
  const row = (m) => [
    m.month,
    m.orders,
    m.totalSales,
    m.outOfStateSales,
    m.caOrders,
    m.caMerchandise,
    m.caShipping,
    m.caTaxableSales,
    m.taxCollected,
    m.caUntaxedOrders,
    m.caUntaxedSales,
    ...districtNames.map((n) => m.districts[n]?.taxableSales || 0),
  ];
  return [head, ...report.months.map(row), row(report.total)].map((r) => r.map(csvCell).join(",")).join("\n");
}
