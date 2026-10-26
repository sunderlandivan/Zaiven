// Port of server/storePublish.js, server/manualOrders.js and the website part of server/emailIntake.js.
import { logActivity, readDoc, writeDoc } from "./docs.js";
import { GoogleBudget, sheetWritesEnabled } from "./google.js";
import { canWrite } from "./lease.js";
import { applySaleLine, findBestRow, getSheetSettings, readTab } from "./sheet.js";

export const MANUAL_LABELS = { zelle: "Zelle", venmo: "Venmo" };
export const isManualOrder = (o) => Boolean(MANUAL_LABELS[o?.paymentMethod]);
export const isPaidOrder = (o) => !isManualOrder(o) || o.status === "paid";
export const isCancelledOrder = (o) => o?.status === "cancelled";
const round2 = (n) => Math.round(n * 100) / 100;

export async function getRole(env) {
  return (await readDoc(env, "portal-role", null)) || { role: "shadow", since: null };
}

export async function readWebOrders(env) {
  return (await readDoc(env, "web-orders", {}))?.orders || [];
}
const saveWebOrders = (env, orders) => writeDoc(env, "web-orders", { orders });

async function readState(env) {
  return (await readDoc(env, "store-publish-state", {})) || {};
}
async function patchState(env, patch) {
  await writeDoc(env, "store-publish-state", { ...(await readState(env)), ...patch });
}

// ---------- manual payments ----------

const MANUAL_DEFAULTS = {
  zelle: { enabled: true, email: "", phone: "", displayName: "", holdHours: 24, maxOrder: 2500, feePct: 0, feeFixed: 0 },
  venmo: { enabled: true, handle: "", holdHours: 24, maxOrder: 2500, feePct: 1.9, feeFixed: 0.1 },
};

export async function readStoreSettings(env) {
  return (await readDoc(env, "store-settings", {})) || {};
}

function manualPaySettings(storeSettings) {
  const saved = storeSettings.manualPayments || {};
  return { zelle: { ...MANUAL_DEFAULTS.zelle, ...saved.zelle }, venmo: { ...MANUAL_DEFAULTS.venmo, ...saved.venmo } };
}

/** What checkout may show buyers: never the Zelle phone or the fee rates. */
function publicManualPayConfig(storeSettings) {
  const { zelle: z, venmo: v } = manualPaySettings(storeSettings);
  return {
    zelle: { enabled: Boolean(z.enabled), email: z.email, displayName: z.displayName, holdHours: z.holdHours, maxOrder: z.maxOrder },
    venmo: { enabled: Boolean(v.enabled), handle: String(v.handle || "").replace(/^@/, ""), holdHours: v.holdHours, maxOrder: v.maxOrder },
  };
}

function expireManual(orders, now = Date.now()) {
  const expired = orders.filter((o) => isManualOrder(o) && o.status === "awaiting_payment" && Date.parse(o.expiresAt) <= now);
  for (const o of expired) Object.assign(o, { status: "cancelled", cancelledAt: new Date(now).toISOString(), cancelReason: "expired" });
  return expired;
}

function findManual(orders, id) {
  const o = orders.find((x) => x.id === id);
  if (!o) throw new Error("Order not found. It may not have been pulled from the website yet; try again in a minute.");
  if (!isManualOrder(o)) throw new Error("Only Zelle and Venmo orders can be marked paid or cancelled here.");
  return o;
}

async function sendPaidEmail(env, order) {
  if (!env.AGENT_TOKEN) return { sent: false, reason: "AGENT_TOKEN not set in the cloud portal" };
  try {
    const res = await fetch(`${env.STORE_SITE}/api/manual/mark-paid`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.AGENT_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ order }),
    });
    const body = await res.json().catch(() => ({}));
    return res.ok ? body.email : { sent: false, reason: body.error || `HTTP ${res.status}` };
  } catch (e) {
    return { sent: false, reason: e.message };
  }
}

export async function markManualOrderPaid(env, id) {
  await pullWebOrders(env);
  const orders = await readWebOrders(env);
  const o = findManual(orders, id);
  if (o.status === "paid") return { order: o, email: o.paidEmail || null };
  if (o.status !== "awaiting_payment") throw new Error(`This order is ${o.status}; it can't be marked paid.`);
  const s = manualPaySettings(await readStoreSettings(env))[o.paymentMethod] || {};
  Object.assign(o, { status: "paid", paidAt: new Date().toISOString(), paymentFee: round2((o.total * Number(s.feePct || 0)) / 100 + Number(s.feeFixed || 0)) });
  await saveWebOrders(env, orders);
  o.paidEmail = o.test ? { sent: false, reason: "test order, email skipped" } : await sendPaidEmail(env, o);
  await saveWebOrders(env, orders);
  await logActivity(env, "order", `${MANUAL_LABELS[o.paymentMethod]} order ${o.id} marked paid`);
  return { order: o, email: o.paidEmail };
}

export async function cancelManualOrder(env, id, reason = "cancelled by owner") {
  await pullWebOrders(env);
  const orders = await readWebOrders(env);
  const o = findManual(orders, id);
  if (o.status !== "cancelled") {
    if (o.status !== "awaiting_payment") throw new Error(`This order is ${o.status}; only unpaid orders can be cancelled here.`);
    Object.assign(o, { status: "cancelled", cancelledAt: new Date().toISOString(), cancelReason: reason });
    await saveWebOrders(env, orders);
    await logActivity(env, "order", `${MANUAL_LABELS[o.paymentMethod]} order ${o.id} cancelled`);
  }
  return { order: o, data: await pushStoreData(env, { force: true }) };
}

// ---------- website orders in KV ----------

/** Shadow mode: look at waiting orders without removing them (the PC portal still pulls them). Totals only, no addresses. */
export async function peekKvOrders(env) {
  const { keys } = await env.STORE.list({ prefix: "order:" });
  const orders = [];
  for (const k of keys.slice(0, 25)) {
    const o = await env.STORE.get(k.name, "json");
    if (o) orders.push({ id: o.id, status: o.status || "paid", paymentMethod: o.paymentMethod || "paypal", total: o.total, createdAt: o.createdAt, items: (o.lines || []).reduce((s, l) => s + l.qty, 0) });
  }
  const doc = { at: new Date().toISOString(), count: keys.length, orders };
  await writeDoc(env, "kv-pending-orders", doc);
  return doc;
}

/** Active host only: move paid orders from KV into the web-orders doc, then delete them from KV (same as the PC portal). */
export async function pullWebOrders(env, { writer } = {}) {
  if (!(writer ?? (await canWrite(env)))) return [];
  const { keys } = await env.STORE.list({ prefix: "order:" });
  if (!keys.length) return [];
  const orders = await readWebOrders(env);
  const known = new Set(orders.map((o) => o.id));
  const fresh = [];
  for (const k of keys) {
    const order = await env.STORE.get(k.name, "json");
    if (order && !known.has(order.id)) {
      orders.push({ ...order, pulledAt: new Date().toISOString() });
      known.add(order.id);
      fresh.push(order);
    }
  }
  await saveWebOrders(env, orders);
  for (const k of keys) await env.STORE.delete(k.name);
  for (const o of fresh) {
    const what = isManualOrder(o) && o.status === "awaiting_payment" ? `${MANUAL_LABELS[o.paymentMethod]} order awaiting payment` : "New website order";
    await logActivity(env, "order", `${what}: ${o.id} $${Number(o.total).toFixed(2)}`);
  }
  return fresh;
}

// ---------- stock pushed to the website ----------

async function readQueue(env) {
  const q = (await readDoc(env, "sheet-sync-queue", null)) || {};
  return { events: [], seenMessageIds: [], ...q };
}

/** Sold on the website but not yet written to Sold 2026 (unpaid Zelle/Venmo still hold stock; cancelled ones released it). */
function unsyncedWebQty(orders, queue) {
  const applied = new Set(queue.events.filter((e) => e.status === "applied").map((e) => e.id));
  const qty = new Map();
  for (const o of orders) {
    if (applied.has(`web:${o.id}`) || isCancelledOrder(o)) continue;
    for (const l of o.lines || []) qty.set(l.id, (qty.get(l.id) || 0) + l.qty);
  }
  return qty;
}

export async function currentStock(env) {
  const stock = await readDoc(env, "store-stock", null);
  if (!stock) return null;
  const [orders, queue] = await Promise.all([readWebOrders(env), readQueue(env)]);
  for (const [id, q] of unsyncedWebQty(orders, queue)) if (stock.items[id]) stock.items[id].q = Math.max(0, stock.items[id].q - q);
  return stock;
}

async function sha256(text) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const PUSH_INPUTS = ["catalog", "store-stock", "web-orders", "sheet-sync-queue", "store-settings"];

/** Cheap change check from doc timestamps, so idle ticks don't parse the catalog (Workers Free allows 10 ms CPU). */
async function pushInputsKey(env) {
  const { results } = await env.DB.prepare(`SELECT name, updated_at FROM docs WHERE name IN (${PUSH_INPUTS.map(() => "?").join(",")}) ORDER BY name`)
    .bind(...PUSH_INPUTS)
    .all();
  return results.map((r) => `${r.name}@${r.updated_at}`).join("|");
}

export async function pushStoreData(env, { force = false, writer } = {}) {
  if (!(writer ?? (await canWrite(env)))) return { pushed: false, reason: "not the active host" };
  const inputsKey = await pushInputsKey(env);
  if (!force && (await readState(env)).inputsKey === inputsKey) return { pushed: false, reason: "unchanged" };
  const catalog = await readDoc(env, "catalog", null);
  const stock = await currentStock(env);
  if (!catalog || !stock) return { pushed: false, reason: "catalog not migrated yet" };
  const { updatedAt, ...catalogBody } = catalog;
  const storeSettings = await readStoreSettings(env);
  const manualPay = JSON.stringify(publicManualPayConfig(storeSettings));
  stock.salesTax = storeSettings.salesTax || { enabled: false };
  const fingerprint = await sha256(JSON.stringify(catalogBody) + JSON.stringify(stock.items) + JSON.stringify(stock.shipping) + JSON.stringify(stock.salesTax) + manualPay);
  const state = await readState(env);
  if (!force && state.dataHash === fingerprint) {
    await patchState(env, { inputsKey });
    return { pushed: false, reason: "unchanged" };
  }
  await env.STORE.put("catalog", JSON.stringify(catalog));
  await env.STORE.put("stock", JSON.stringify(stock));
  await env.STORE.put("manual-pay-config", manualPay);
  await patchState(env, { dataHash: fingerprint, inputsKey, lastPushAt: new Date().toISOString() });
  return { pushed: true };
}

// ---------- website sales -> Sold 2026 ----------

const saleDate = (iso) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });

function webSaleEvent(o) {
  const product = o.lines.reduce((s, l) => s + l.price * l.qty, 0) || 1;
  const fee = Number(o.paymentFee ?? o.paypalFee ?? 0);
  return {
    id: `web:${o.id}`,
    kind: "sale",
    source: "web",
    vendor: "PreEminent Store",
    orderNumber: o.id,
    date: saleDate(o.paidAt || o.createdAt),
    subject: o.channel ? `${o.channel} order ${o.id}` : `Website order ${o.id}`,
    parseConfident: true,
    lines: o.lines.map((l, i) => ({
      storeId: l.id,
      description: l.single ? l.name : l.title,
      qty: l.qty,
      unitPrice: l.price,
      shipping: i === 0 ? o.shipping : 0,
      fees: round2((fee * l.price * l.qty) / product),
      ...(l.single ? { plan: { action: "single", locked: true } } : {}),
    })),
  };
}

/** ~7 Sheets calls per sold line; leave room for the token refresh and the planning read. */
const CALLS_PER_LINE = 7;

/**
 * Writes paid, not-yet-logged website orders to the Sheet. Lines that don't match an Inventory26 row with enough stock
 * go to review (the PC portal or a later phase resolves them); nothing is ever written to Inventory25 / Sold 2025.
 */
export async function runWebSaleIntake(env, budget = new GoogleBudget()) {
  const queue = await readQueue(env);
  const known = new Set(queue.events.map((e) => e.id));
  const pending = (await readWebOrders(env)).filter((o) => !known.has(`web:${o.id}`) && isPaidOrder(o) && !isCancelledOrder(o) && !o.test);
  const summary = { at: new Date().toISOString(), trigger: "cloud-web-order", newEvents: 0, applied: 0, needsReview: 0, errors: 0, deferred: 0 };
  if (!pending.length) return summary;
  const settings = await getSheetSettings(env);
  const aliases = (await readDoc(env, "sheet-sync-aliases", {})) || {};
  let rows = (await readTab(env, budget, settings.purchaseTab)).rows;
  const stock = await readDoc(env, "store-stock", null);
  for (const o of pending) {
    if (budget.left < o.lines.length * CALLS_PER_LINE + 1) {
      summary.deferred += 1;
      continue;
    }
    const ev = webSaleEvent(o);
    ev.createdAt = new Date().toISOString();
    for (const line of ev.lines) {
      if (line.plan?.locked) continue;
      const m = findBestRow(line.description, rows, aliases, { requireStock: true });
      line.match = m.row ? { tab: m.row.tab, itemId: m.row.itemId, score: m.score, lastRetail: m.row.lastRetail } : null;
      if (m.confident && Number(m.row.qty) >= line.qty) line.plan = { action: "sell", stockRow: m.row };
      else line.plan = { action: "review", note: m.row ? `Best match "${m.row.itemId}" (${m.score}) isn't certain or has too little stock in ${settings.purchaseTab}.` : `No ${settings.purchaseTab} row matched.` };
    }
    ev.status = ev.lines.every((l) => l.plan.action !== "review") ? "ready" : "needs_review";
    if (ev.status === "ready" && sheetWritesEnabled(env)) {
      const results = [];
      let failed = false;
      for (const line of ev.lines) {
        try {
          results.push(
            ...(await applySaleLine(env, budget, {
              description: line.description,
              qty: line.qty,
              unitPrice: line.unitPrice,
              shipping: line.shipping,
              fees: line.fees,
              date: ev.date,
              stockRow: line.plan.action === "sell" ? line.plan.stockRow : null,
              single: line.plan.action === "single",
            }))
          );
          line.applied = true;
        } catch (e) {
          failed = true;
          line.error = e.message;
        }
      }
      ev.results = results;
      ev.status = failed ? "error" : "applied";
      ev.appliedAt = new Date().toISOString();
      if (ev.status === "applied" && stock) {
        // The sheet now carries this sale; take it off the base stock so the website doesn't count it twice.
        for (const l of o.lines) if (stock.items[l.id]) stock.items[l.id].q = Math.max(0, stock.items[l.id].q - l.qty);
      }
      rows = (await readTab(env, budget, settings.purchaseTab)).rows;
    } else if (ev.status === "ready") {
      ev.note = "Sheet writes are off in this environment; nothing was written.";
    }
    queue.events.push(ev);
    summary.newEvents += 1;
    if (ev.status === "applied") summary.applied += 1;
    else if (ev.status === "error") summary.errors += 1;
    else summary.needsReview += 1;
  }
  queue.lastCloudRun = summary;
  await writeDoc(env, "sheet-sync-queue", queue);
  if (stock && summary.applied) await writeDoc(env, "store-stock", stock);
  return summary;
}

// ---------- one publish cycle (active host only) ----------

export async function publishCycle(env, { writer } = {}) {
  if (!(writer ?? (await canWrite(env)))) return { skipped: true, reason: "not the active host (no lease)" };
  const result = {};
  try {
    const fresh = await pullWebOrders(env, { writer: true });
    result.newOrders = fresh.length;
    const orders = await readWebOrders(env);
    const expired = expireManual(orders);
    if (expired.length) {
      await saveWebOrders(env, orders);
      for (const o of expired) await logActivity(env, "order", `${MANUAL_LABELS[o.paymentMethod]} order ${o.id} expired unpaid`);
    }
    result.expiredManualOrders = expired.length;
    result.intake = await runWebSaleIntake(env);
    result.data = await pushStoreData(env, { writer: true });
    await patchState(env, { lastRunAt: new Date().toISOString(), lastError: "", lastRunBy: "cloud" });
  } catch (e) {
    result.error = e.message;
    await patchState(env, { lastRunAt: new Date().toISOString(), lastError: e.message, lastRunBy: "cloud" });
  }
  return result;
}
