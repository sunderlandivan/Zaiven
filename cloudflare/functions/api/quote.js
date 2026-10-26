import { json, priceCart, withTax } from "../../lib/store.js";
import { taxLabel } from "../../lib/salesTax.js";

/** POST { cart, shipTo: { state, zip, city?, line1? } } -> the order totals checkout will charge for that address. */
export async function onRequestPost({ request, env }) {
  const { cart, shipTo } = await request.json().catch(() => ({}));
  const stock = await env.STORE.get("stock", "json");
  if (!stock) return json({ error: "The store is updating. Please try again in a minute." }, 503);
  const priced = priceCart(stock, cart);
  if (priced.error) return json(priced, 409);
  const clean = (v, n) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
  const quote = await withTax(env, stock, priced, {
    state: clean(shipTo?.state, 2),
    zip: clean(shipTo?.zip, 10),
    city: clean(shipTo?.city, 100),
    line1: clean(shipTo?.line1, 200),
  });
  return json({
    subtotal: quote.subtotal / 100,
    shipping: quote.shipping / 100,
    tax: quote.tax.cents / 100,
    taxLabel: quote.tax.cents ? taxLabel(quote.tax) : "",
    total: quote.total / 100,
  });
}
