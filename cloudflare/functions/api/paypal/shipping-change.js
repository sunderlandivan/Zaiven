import { json, paypal, paypalAmount, paypalShipTo, priceCart, withTax } from "../../../lib/store.js";
import { taxLabel } from "../../../lib/salesTax.js";

/**
 * Called from the PayPal button's onShippingAddressChange while the buyer is in the PayPal window.
 * POST { orderID, shippingAddress: { countryCode, state, postalCode, city } }
 * Re-prices the order for that address (California sales tax) and patches the PayPal order total.
 */
export async function onRequestPost({ request, env }) {
  const { orderID, shippingAddress: a = {} } = await request.json().catch(() => ({}));
  if (!/^[A-Z0-9]{10,30}$/.test(String(orderID || ""))) return json({ error: "Missing order." }, 400);
  if (a.countryCode !== "US") return json({ error: "We only ship within the United States." }, 400);

  const pending = await env.STORE.get(`pending:${orderID}`, "json");
  if (!pending) return json({ error: "This checkout expired. Please try again." }, 410);
  const stock = await env.STORE.get("stock", "json");
  const priced = priceCart(stock, pending.cart);
  if (priced.error) return json(priced, 409);
  // PayPal shares only city/state/ZIP here, so this is the city + ZIP estimate; capture re-checks the street address.
  const quote = await withTax(env, stock, priced, paypalShipTo(a));

  if (pending.total !== quote.total) {
    const patch = await paypal(env, "PATCH", `/v2/checkout/orders/${orderID}`, [
      { op: "replace", path: "/purchase_units/@reference_id=='default'/amount", value: paypalAmount(quote) },
    ]);
    if (!patch.ok) return json({ error: "Couldn't update the total for this address.", issue: patch.data?.details?.[0]?.issue }, 502);
    await env.STORE.put(`pending:${orderID}`, JSON.stringify({ ...pending, total: quote.total }), { expirationTtl: 6 * 3600 });
  }
  return json({
    ok: true,
    subtotal: quote.subtotal / 100,
    shipping: quote.shipping / 100,
    tax: quote.tax.cents / 100,
    taxLabel: quote.tax.cents ? taxLabel(quote.tax) : "",
    total: quote.total / 100,
  });
}
