import { json, priceCart, cents, withTax } from "../../../lib/store.js";
import { taxLabel, taxRecord } from "../../../lib/salesTax.js";
import { METHODS, expireStaleManualOrders, manualPayConfig, newOrderId } from "../../../lib/manualPay.js";
import { sendAwaitingPaymentEmail } from "../../../lib/orderEmail.js";

const US_STATES = new Set(
  "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" "),
);
// Each open order holds stock for a day, so one visitor can't tie up the shelves with fake orders.
const MAX_OPEN_PER_IP = 3;

const clean = (v, n) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);

/**
 * POST { method: "zelle" | "venmo", cart, ref, buyer: { name, email }, shipTo: { line1, line2, city, state, zip } }
 * Reserves the stock and records an order awaiting the buyer's Zelle/Venmo payment.
 */
export async function onRequestPost(context) {
  const { request, env } = context;
  const body = await request.json().catch(() => ({}));
  const method = String(body.method || "");
  if (!METHODS[method]) return json({ error: "Choose a payment method." }, 400);
  const cfg = (await manualPayConfig(env))[method];
  if (!cfg.enabled) return json({ error: `${METHODS[method].label} isn't available right now. Please use PayPal or card.` }, 400);

  const name = clean(body.buyer?.name, 100);
  const email = clean(body.buyer?.email, 200).toLowerCase();
  const a = body.shipTo || {};
  const line1 = clean(a.line1, 200);
  const line2 = clean(a.line2, 200);
  const city = clean(a.city, 100);
  const state = clean(a.state, 2).toUpperCase();
  const zip = clean(a.zip, 10);
  if (name.length < 2) return json({ error: "Please enter your full name." }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return json({ error: "Please enter a valid email address." }, 400);
  if (!line1 || !city) return json({ error: "Please enter your street address and city." }, 400);
  if (!US_STATES.has(state)) return json({ error: "Please choose a US state. We ship within the United States only." }, 400);
  if (!/^\d{5}(-\d{4})?$/.test(zip)) return json({ error: "Please enter a valid 5-digit ZIP code." }, 400);

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const ipKey = `manual-ip:${ip}`;
  const openFromIp = Number(await env.STORE.get(ipKey)) || 0;
  if (openFromIp >= MAX_OPEN_PER_IP) {
    return json({ error: "You already have several orders waiting for payment. Please pay those first or email sales@preeminentstore.com." }, 429);
  }

  context.waitUntil?.(expireStaleManualOrders(env).catch((e) => console.log(`Expire error: ${e.message}`)));

  const stock = await env.STORE.get("stock", "json");
  if (!stock) return json({ error: "The store is updating. Please try again in a minute." }, 503);
  const cartPrice = priceCart(stock, body.cart);
  if (cartPrice.error) return json(cartPrice, 409);
  const priced = await withTax(env, stock, cartPrice, { state, zip, city, line1 });
  if (priced.total > cents(cfg.maxOrder)) {
    return json({ error: `${METHODS[method].label} is available for orders up to $${cfg.maxOrder.toLocaleString("en-US")}. Please use PayPal or card for this order.` }, 400);
  }

  for (const l of priced.lines) stock.items[l.id].q = Math.max(0, stock.items[l.id].q - l.qty);
  await env.STORE.put("stock", JSON.stringify(stock));

  const id = await newOrderId(env, method);
  const now = new Date();
  const record = {
    id,
    paymentMethod: method,
    status: "awaiting_payment",
    captureId: "",
    captureStatus: "",
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + cfg.holdHours * 3600_000).toISOString(),
    ref: String(body.ref || "").toLowerCase().replace(/[^a-z0-9_.-]/g, "").slice(0, 60),
    lines: priced.lines.map(({ id, qty, name, title, single, priceCents }) => ({ id, qty, name, title, single, price: priceCents / 100 })),
    subtotal: priced.subtotal / 100,
    shipping: priced.shipping / 100,
    ...taxRecord(priced.tax),
    total: priced.total / 100,
    paypalFee: 0,
    payer: { name, email },
    shipTo: {
      name,
      address: { address_line_1: line1, ...(line2 ? { address_line_2: line2 } : {}), admin_area_2: city, admin_area_1: state, postal_code: zip, country_code: "US" },
    },
  };
  await env.STORE.put(`order:${id}`, JSON.stringify(record));
  await env.STORE.put(ipKey, String(openFromIp + 1), { expirationTtl: 24 * 3600 });

  const mail = sendAwaitingPaymentEmail(env, record, cfg).catch((e) => console.log(`Awaiting email error: ${e.message}`));
  context.waitUntil?.(mail);
  return json({
    ok: true,
    id,
    method,
    subtotal: record.subtotal,
    shipping: record.shipping,
    tax: record.tax,
    taxLabel: priced.tax.cents ? taxLabel(priced.tax) : "",
    total: record.total,
    expiresAt: record.expiresAt,
    pay: cfg,
  });
}
