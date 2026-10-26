import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { readWebOrders, saveWebOrders } from "./webOrders.js";
import { notifyDesktop } from "./desktopNotify.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SETTINGS_PATH = path.join(ROOT, "data", "store-settings.json");
const AGENT_TOKEN_PATH = path.join(ROOT, "data", "agent-token.json");
const SITE = "https://preeminentstore.com";

export const MANUAL_LABELS = { zelle: "Zelle", venmo: "Venmo" };
export const isManualOrder = (o) => Boolean(MANUAL_LABELS[o?.paymentMethod]);
/** PayPal orders are paid at checkout; Zelle/Venmo only once the owner marks them paid. */
export const isPaidOrder = (o) => !isManualOrder(o) || o.status === "paid";
export const isCancelledOrder = (o) => o?.status === "cancelled";

const DEFAULTS = {
  zelle: { enabled: true, email: "", phone: "", displayName: "", holdHours: 24, maxOrder: 2500, feePct: 0, feeFixed: 0 },
  venmo: { enabled: true, handle: "", holdHours: 24, maxOrder: 2500, feePct: 1.9, feeFixed: 0.1 },
};

export function readManualPaySettings() {
  let saved = {};
  try {
    saved = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8")).manualPayments || {};
  } catch {
    /* defaults */
  }
  return { zelle: { ...DEFAULTS.zelle, ...saved.zelle }, venmo: { ...DEFAULTS.venmo, ...saved.venmo } };
}

/** What checkout may show buyers. The Zelle phone and the fee rates stay on the PC. */
export function publicManualPayConfig() {
  const { zelle: z, venmo: v } = readManualPaySettings();
  return {
    zelle: { enabled: Boolean(z.enabled), email: z.email, displayName: z.displayName, holdHours: z.holdHours, maxOrder: z.maxOrder },
    venmo: { enabled: Boolean(v.enabled), handle: String(v.handle || "").replace(/^@/, ""), holdHours: v.holdHours, maxOrder: v.maxOrder },
  };
}

const round2 = (n) => Math.round(n * 100) / 100;
function paymentFee(order) {
  const s = readManualPaySettings()[order.paymentMethod] || {};
  return round2((order.total * Number(s.feePct || 0)) / 100 + Number(s.feeFixed || 0));
}

function agentToken() {
  try {
    return JSON.parse(fs.readFileSync(AGENT_TOKEN_PATH, "utf8")).token || "";
  } catch {
    return "";
  }
}

function updateOrder(id, patch) {
  const orders = readWebOrders();
  const o = orders.find((x) => x.id === id);
  Object.assign(o, patch);
  saveWebOrders(orders);
  return o;
}

function findManual(id) {
  const o = readWebOrders().find((x) => x.id === id);
  if (!o) throw new Error("Order not found. It may not have been pulled from the website yet; try again in a minute.");
  if (!isManualOrder(o)) throw new Error("Only Zelle and Venmo orders can be marked paid or cancelled here.");
  return o;
}

async function sendPaidEmail(order) {
  try {
    const res = await fetch(`${SITE}/api/manual/mark-paid`, {
      method: "POST",
      headers: { Authorization: `Bearer ${agentToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ order }),
    });
    const body = await res.json().catch(() => ({}));
    return res.ok ? body.email : { sent: false, reason: body.error || `HTTP ${res.status}` };
  } catch (e) {
    return { sent: false, reason: e.message };
  }
}

/** Owner saw the money in their bank/Venmo app: record it, email the buyer their confirmation. */
export async function markManualOrderPaid(id) {
  const o = findManual(id);
  if (o.status === "paid") return { order: o, email: o.paidEmail || null };
  if (o.status !== "awaiting_payment") throw new Error(`This order is ${o.status}; it can't be marked paid.`);
  const paid = updateOrder(id, { status: "paid", paidAt: new Date().toISOString(), paymentFee: paymentFee(o) });

  const email = o.test ? { sent: false, reason: "test order, email skipped" } : await sendPaidEmail(paid);
  const order = updateOrder(id, { paidEmail: email });

  const singles = order.lines.filter((l) => l.single);
  if (singles.length && !order.test) {
    notifyDesktop("Delist on TCGplayer", `Sold on the website: ${singles.map((l) => `${l.qty}× ${l.title}`).join(", ")}. Lower these on TCGplayer.`);
  }
  return { order, email };
}

export function cancelManualOrder(id, reason = "cancelled by owner") {
  const o = findManual(id);
  if (o.status === "cancelled") return o;
  if (o.status !== "awaiting_payment") throw new Error(`This order is ${o.status}; only unpaid orders can be cancelled here.`);
  return updateOrder(id, { status: "cancelled", cancelledAt: new Date().toISOString(), cancelReason: reason });
}

/** Cancels unpaid Zelle/Venmo orders past their hold. Returns the expired orders. */
export function expireManualOrders(now = Date.now()) {
  const orders = readWebOrders();
  const expired = orders.filter((o) => isManualOrder(o) && o.status === "awaiting_payment" && Date.parse(o.expiresAt) <= now);
  if (!expired.length) return [];
  for (const o of expired) Object.assign(o, { status: "cancelled", cancelledAt: new Date(now).toISOString(), cancelReason: "expired" });
  saveWebOrders(orders);
  for (const o of expired.filter((x) => !x.test)) notifyDesktop(`${MANUAL_LABELS[o.paymentMethod]} order expired`, `${o.id} ($${o.total.toFixed(2)}) wasn't paid in time. Its stock is back on the website.`);
  return expired;
}
