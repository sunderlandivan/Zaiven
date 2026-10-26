// What each role may see in API responses. Staff get what's needed to pick, pack and ship: no order totals, costs,
// profit, fees or payment details. Managers see money but not PayPal/payment identifiers. Owners see everything.
import { atLeast } from "./access.js";

const omit = (obj, keys) => {
  if (!obj || typeof obj !== "object") return obj;
  const out = { ...obj };
  for (const k of keys) delete out[k];
  return out;
};

const PAYMENT_IDS = ["captureId", "captureStatus", "invoiceUrl", "paypalFee", "paymentFee", "paidEmail"];
const WEB_ORDER_MONEY = ["subtotal", "shipping", "total", "tax", "taxInfo", "shippingCost", "invoiceNumber"];

export function webOrderFor(role, o) {
  if (atLeast(role, "owner")) return o;
  const base = omit(o, PAYMENT_IDS);
  if (atLeast(role, "manager")) return base;
  return {
    ...omit(base, [...WEB_ORDER_MONEY, "payer"]),
    lines: (o.lines || []).map((l) => omit(l, ["price"])),
    shippingLabels: (o.shippingLabels || []).map((s) => omit(s, ["cost"])),
  };
}

const TCG_ORDER_MONEY = ["salePrice", "feeAmount", "orderAmount", "shippingCost", "buyerTax", "feesAuto", "cogs", "rawCarrierInfo"];

export function tcgOrderFor(role, o) {
  if (atLeast(role, "manager")) return o;
  return { ...omit(o, TCG_ORDER_MONEY), lineItems: (o.lineItems || []).map((l) => ({ description: l.description, quantity: l.quantity })) };
}

const STOCK_MONEY = ["unitCost", "totalInv", "feePerUnit", "profitPerUnit", "profitTotal", "marginPct"];

export function stockViewFor(role, view) {
  if (atLeast(role, "manager")) return view;
  return {
    items: view.items.map((r) => omit(r, STOCK_MONEY)),
    unmatched: [],
    itemOptions: [],
    summary: omit(view.summary, ["grandTotalInv", "estProfit"]),
  };
}

/** Website stock: "f" is the lowest price that keeps the profit floor (derived from cost). */
export function storeStockFor(role, stock) {
  if (!stock || atLeast(role, "manager")) return stock;
  const items = {};
  for (const [id, it] of Object.entries(stock.items || {})) items[id] = omit(it, ["f"]);
  return { ...stock, items };
}
