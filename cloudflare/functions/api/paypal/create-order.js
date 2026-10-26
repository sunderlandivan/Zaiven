import { json, paypal, paypalAmount, priceCart, usd } from "../../../lib/store.js";

export async function onRequestPost({ request, env }) {
  const { cart, ref } = await request.json().catch(() => ({}));
  const stock = await env.STORE.get("stock", "json");
  if (!stock) return json({ error: "The store is updating. Please try again in a minute." }, 503);
  const priced = priceCart(stock, cart);
  if (priced.error) return json(priced, 409);

  const money = (c) => ({ currency_code: "USD", value: usd(c) });
  // Tax starts at zero: PayPal knows the ship-to address only after the buyer logs in, so shipping-change.js
  // adds California tax then, and capture-order.js checks it again before taking the money.
  const { ok, data } = await paypal(env, "POST", "/v2/checkout/orders", {
    intent: "CAPTURE",
    purchase_units: [
      {
        description: "The PreEminent Store order",
        amount: paypalAmount(priced),
        items: priced.lines.map((l) => ({
          name: l.title.slice(0, 127),
          sku: l.id.slice(0, 127),
          quantity: String(l.qty),
          unit_amount: money(l.priceCents),
          category: "PHYSICAL_GOODS",
        })),
      },
    ],
    application_context: { brand_name: "The PreEminent Store", shipping_preference: "GET_FROM_FILE", user_action: "PAY_NOW" },
  });
  if (!ok) return json({ error: "PayPal couldn't start checkout. Please try again.", issue: data?.details?.[0]?.issue }, 502);

  await env.STORE.put(
    `pending:${data.id}`,
    JSON.stringify({
      cart: priced.lines.map(({ id, qty }) => ({ id, qty })),
      ref: String(ref || "").toLowerCase().replace(/[^a-z0-9_.-]/g, "").slice(0, 60),
      total: priced.total,
      createdAt: new Date().toISOString(),
    }),
    { expirationTtl: 6 * 3600 },
  );
  return json({ id: data.id });
}
