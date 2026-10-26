import { salesTaxFor } from "./salesTax.js";

export const cents = (n) => Math.round(Number(n) * 100);
export const usd = (c) => (c / 100).toFixed(2);

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function paypalToken(env) {
  const r = await fetch(`${env.PAYPAL_API}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + btoa(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_SECRET}`),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!r.ok) throw new Error(`PayPal auth failed (${r.status})`);
  return (await r.json()).access_token;
}

export async function paypal(env, method, path, body, headers = {}) {
  const token = await paypalToken(env);
  const r = await fetch(`${env.PAYPAL_API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) };
}

/**
 * Prices a cart from the private stock list. The browser only says which items and how many;
 * prices, shipping and availability always come from here.
 */
export function priceCart(stock, cart) {
  const qtyById = new Map();
  for (const raw of Array.isArray(cart) ? cart : []) {
    const id = String(raw?.id || "");
    const qty = Math.floor(Number(raw?.qty));
    if (id && qty > 0) qtyById.set(id, (qtyById.get(id) || 0) + qty);
  }
  const lines = [];
  for (const [id, qty] of qtyById) {
    const it = stock?.items?.[id];
    if (!it || it.q <= 0) return { error: "Something in your cart just sold out. Please remove it and try again.", id };
    if (qty > it.q) return { error: `Sorry, we don't have that many of ${it.n} right now. Please lower the quantity.`, id };
    const deckShipCents = it.s === "deck" && it.sh > 0 ? cents(it.sh) : null;
    lines.push({ id, qty, name: it.n, title: it.t, single: it.s === "single", priceCents: cents(it.p), ...(deckShipCents ? { deckShipCents } : {}) });
  }
  if (!lines.length) return { error: "Your cart is empty." };
  const subtotal = lines.reduce((s, l) => s + l.priceCents * l.qty, 0);
  const sh = stock.shipping || {};
  // One flat charge per order: standard if anything sealed is in it, else the custom-deck rate, else the single-card rate.
  const sealed = lines.some((l) => !l.single && !l.deckShipCents);
  const deckRate = Math.max(0, ...lines.map((l) => l.deckShipCents || 0));
  const rate = sealed ? cents(sh.standard) : deckRate || cents(sh.single);
  const shipping = sh.freeOver && subtotal >= cents(sh.freeOver) ? 0 : rate;
  return { lines, subtotal, shipping, total: subtotal + shipping };
}

/** Adds sales tax for the ship-to address (to: { state, zip, city?, line1? }) to a priced cart; total includes it. */
export async function withTax(env, stock, priced, to) {
  const tax = await salesTaxFor(env, stock?.salesTax, to, priced);
  return { ...priced, tax, total: priced.subtotal + priced.shipping + tax.cents };
}

const money = (c) => ({ currency_code: "USD", value: usd(c) });

/** PayPal purchase_units[].amount for a priced cart (with or without tax). */
export function paypalAmount(priced) {
  return {
    ...money(priced.total),
    breakdown: { item_total: money(priced.subtotal), shipping: money(priced.shipping), tax_total: money(priced.tax?.cents || 0) },
  };
}

/** PayPal's address object (order API or the button's onShippingAddressChange) -> salesTaxFor's ship-to. */
export const paypalShipTo = (a = {}) => ({
  state: a.admin_area_1 || a.state || "",
  zip: a.postal_code || a.postalCode || "",
  city: a.admin_area_2 || a.city || "",
  line1: a.address_line_1 || "",
});
