import { json, paypal, paypalAmount, paypalShipTo, priceCart, usd, withTax } from "../../../lib/store.js";
import { taxLabel, taxRecord } from "../../../lib/salesTax.js";
import { sendOrderEmail } from "../../../lib/orderEmail.js";

const NOT_CHARGED = "You have not been charged.";

/**
 * POST { orderID, confirmTotal? } after the buyer approves in PayPal.
 * Re-prices the cart and the sales tax for PayPal's final street address before capturing. If the right total is
 * lower than the approved one, the order is patched down and captured. If it is higher (the address callback didn't
 * run, e.g. some card flows), nothing is charged: the buyer gets the corrected total and confirms it, then this
 * runs again with confirmTotal and patches the order first.
 */
export async function onRequestPost(context) {
  const { request, env } = context;
  const { orderID, confirmTotal } = await request.json().catch(() => ({}));
  if (!/^[A-Z0-9]{10,30}$/.test(String(orderID || ""))) return json({ error: "Missing order." }, 400);
  if (await env.STORE.get(`order:${orderID}`)) return json({ ok: true, id: orderID });

  const pending = await env.STORE.get(`pending:${orderID}`, "json");
  if (!pending) return json({ error: `This checkout expired. Please try again. ${NOT_CHARGED}` }, 410);

  const order = await paypal(env, "GET", `/v2/checkout/orders/${orderID}`);
  if (!order.ok) return json({ error: `We couldn't confirm the payment with PayPal. ${NOT_CHARGED}` }, 502);
  const unit = order.data.purchase_units?.[0] || {};
  if (unit.shipping?.address?.country_code !== "US") {
    return json({ error: `Sorry, we only ship within the United States. ${NOT_CHARGED}` }, 400);
  }

  // Stock may have changed since the order was created (TCGplayer sales, another buyer).
  const stock = await env.STORE.get("stock", "json");
  const priced = priceCart(stock, pending.cart);
  if (priced.error) return json({ ...priced, error: `${priced.error} ${NOT_CHARGED}` }, 409);
  const bd = unit.amount?.breakdown || {};
  if (bd.item_total?.value !== usd(priced.subtotal) || (bd.shipping?.value || "0.00") !== usd(priced.shipping)) {
    return json({ error: `Prices changed while you were checking out. Please review your cart. ${NOT_CHARGED}` }, 409);
  }
  const quote = await withTax(env, stock, priced, paypalShipTo(unit.shipping.address));
  if (unit.amount?.value !== usd(quote.total)) {
    // Lower than what the buyer approved (e.g. the street turned out to be outside the city district): just charge less.
    const lower = quote.total < Math.round(Number(unit.amount?.value) * 100);
    if (!lower && confirmTotal !== usd(quote.total)) {
      return json(
        {
          error: `${quote.tax.cents ? `Your total with ${taxLabel(quote.tax)} is $${usd(quote.total)}` : `Your total is $${usd(quote.total)}`}. Please confirm to pay. ${NOT_CHARGED}`,
          taxChanged: true,
          subtotal: quote.subtotal / 100,
          shipping: quote.shipping / 100,
          tax: quote.tax.cents / 100,
          taxLabel: quote.tax.cents ? taxLabel(quote.tax) : "",
          total: quote.total / 100,
        },
        409,
      );
    }
    const patch = await paypal(env, "PATCH", `/v2/checkout/orders/${orderID}`, [
      { op: "replace", path: "/purchase_units/@reference_id=='default'/amount", value: paypalAmount(quote) },
    ]);
    if (!patch.ok) return json({ error: `We couldn't update the total with PayPal. ${NOT_CHARGED}` }, 502);
  }

  const cap = await paypal(env, "POST", `/v2/checkout/orders/${orderID}/capture`, {}, { "PayPal-Request-Id": `capture-${orderID}` });
  const capUnit = cap.data?.purchase_units?.[0] || {};
  const capture = capUnit.payments?.captures?.[0];
  if (!cap.ok || cap.data.status !== "COMPLETED") {
    const issue = cap.data?.details?.[0]?.issue;
    const error = issue === "INSTRUMENT_DECLINED" ? "Your payment method was declined. Please try another one." : `The payment didn't go through. ${NOT_CHARGED}`;
    return json({ error, issue }, 402);
  }

  for (const l of priced.lines) stock.items[l.id].q = Math.max(0, stock.items[l.id].q - l.qty);
  await env.STORE.put("stock", JSON.stringify(stock));

  const shipping = capUnit.shipping || unit.shipping || {};
  const payer = cap.data.payer || {};
  const record = {
    id: orderID,
    captureId: capture?.id || "",
    captureStatus: capture?.status || "",
    createdAt: new Date().toISOString(),
    ref: pending.ref || "",
    lines: priced.lines.map(({ id, qty, name, title, single, priceCents }) => ({ id, qty, name, title, single, price: priceCents / 100 })),
    subtotal: priced.subtotal / 100,
    shipping: priced.shipping / 100,
    ...taxRecord(quote.tax),
    total: quote.total / 100,
    paypalFee: Number(capture?.seller_receivable_breakdown?.paypal_fee?.value || 0),
    payer: { name: [payer.name?.given_name, payer.name?.surname].filter(Boolean).join(" "), email: payer.email_address || "" },
    shipTo: { name: shipping.name?.full_name || "", address: shipping.address || {} },
  };
  await env.STORE.put(`order:${orderID}`, JSON.stringify(record));
  await env.STORE.delete(`pending:${orderID}`);
  // Never let a mail problem hold up or break the buyer's confirmation.
  const mail = sendOrderEmail(env, record).catch((e) => console.log(`Order email error: ${e.message}`));
  context.waitUntil?.(mail);
  // Fields for Google Customer Reviews opt-in on the thank-you screen (Merchant Center Reviews).
  const country = String(record.shipTo?.address?.country_code || "US").toUpperCase();
  const eta = new Date();
  eta.setUTCDate(eta.getUTCDate() + 7); // 2–5 business days policy → calendar estimate for Google
  return json({
    ok: true,
    id: orderID,
    email: record.payer?.email || "",
    deliveryCountry: country,
    estimatedDeliveryDate: eta.toISOString().slice(0, 10),
  });
}
