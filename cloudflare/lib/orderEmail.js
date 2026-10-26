import { venmoPayLink } from "./manualPay.js";

const STORE_EMAIL = "sales@preeminentstore.com";
const SITE = "https://preeminentstore.com";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const money = (n) => `$${Number(n || 0).toFixed(2)}`;
const shortId = (id) => String(id || "").slice(-8);
const METHOD_LABELS = { zelle: "Zelle", venmo: "Venmo" };
const paidVia = (order) => METHOD_LABELS[order.paymentMethod] || "PayPal";
const taxName = (order) => {
  const i = order.taxInfo || {};
  return `Sales tax (${i.state || "CA"}${i.rate ? ` ${+(i.rate * 100).toFixed(3)}%` : ""})`;
};
const firstName = (order) => (order.payer?.name || order.shipTo?.name || "").split(" ")[0];

function addressLines(shipTo = {}) {
  const a = shipTo.address || {};
  const cityLine = [a.admin_area_2, [a.admin_area_1, a.postal_code].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return [shipTo.name, a.address_line_1, a.address_line_2, cityLine].filter(Boolean);
}

/** Plain-text payment steps for an order waiting on Zelle or Venmo. */
function paymentSteps(order, pay) {
  const amount = money(order.total);
  const hold = `Unpaid orders are cancelled after ${pay.holdHours} hours.`;
  if (order.paymentMethod === "venmo") {
    return [
      `Send ${amount} to @${pay.handle} on Venmo with your order number ${order.id} in the note.`,
      `Pay link: ${venmoPayLink(pay.handle, order.total, order.id)}`,
      "If Venmo asks, choose \"Purchase\" (not friends & family).",
      "We ship after the payment arrives (usually same or next day).",
      hold,
    ];
  }
  return [
    `Send ${amount} with Zelle to ${pay.email}${pay.displayName ? ` (${pay.displayName})` : ""}.`,
    `Put your order number ${order.id} in the memo.`,
    "We ship after the payment arrives (usually same or next day).",
    hold,
  ];
}

function textBody(order, pay) {
  const first = firstName(order);
  const awaiting = Boolean(pay);
  return [
    `Hi${first ? ` ${first}` : ""},`,
    "",
    awaiting
      ? `Thanks for your order from The PreEminent Store! Order #${shortId(order.id)} is reserved for you and waiting for your ${paidVia(order)} payment.`
      : `Thanks for your order from The PreEminent Store! Order #${shortId(order.id)} is confirmed and paid via ${paidVia(order)}.`,
    ...(awaiting ? ["", "How to pay:", ...paymentSteps(order, pay).map((s) => `- ${s}`)] : ["It usually ships within 1-2 business days. We'll pack it carefully."]),
    "",
    ...order.lines.map((l) => `${l.qty} x ${l.title || l.name}  ${money(l.price * l.qty)}`),
    "",
    `Subtotal: ${money(order.subtotal)}`,
    `Shipping: ${Number(order.shipping) ? money(order.shipping) : "Free"}`,
    ...(Number(order.tax) ? [`${taxName(order)}: ${money(order.tax)}`] : []),
    `Total:    ${money(order.total)}`,
    "",
    "Shipping to:",
    ...addressLines(order.shipTo),
    "",
    `All sales are final, except damaged or wrong items reported within 3 days of delivery to ${STORE_EMAIL}.`,
    `Questions? Just reply to this email.`,
    "",
    "The PreEminent Store",
    `${SITE} | Instagram @thepreeminentstore | YouTube @thezaiven`,
  ].join("\n");
}

function paymentBox(order, pay, font) {
  const venmo = order.paymentMethod === "venmo";
  const steps = paymentSteps(order, pay).filter((s) => !s.startsWith("Pay link:"));
  const button = venmo
    ? `<a href="${esc(venmoPayLink(pay.handle, order.total, order.id))}" style="${font}display:inline-block;margin-top:12px;padding:12px 22px;border-radius:999px;background:#008cff;color:#ffffff;text-decoration:none;font-weight:bold;font-size:15px;">Pay ${money(order.total)} on Venmo</a>`
    : "";
  return `<tr><td style="padding:20px 28px 0;">
      <div style="${font}background:#fff6f1;border:2px solid #ff5a1f;border-radius:10px;padding:16px 18px;font-size:14px;line-height:1.6;color:#1b1b1f;">
        <div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#b0400f;font-weight:bold;margin-bottom:6px;">How to pay with ${paidVia(order)}</div>
        <div style="font-size:22px;font-weight:bold;margin-bottom:4px;">${money(order.total)}</div>
        ${Number(order.tax) ? `<div style="font-size:12px;color:#666;margin:-2px 0 6px;">Includes ${money(order.tax)} ${esc(order.taxInfo?.state || "CA")} sales tax</div>` : ""}
        <div>${venmo ? `To <strong>@${esc(pay.handle)}</strong> on Venmo` : `To <strong>${esc(pay.email)}</strong>${pay.displayName ? ` (${esc(pay.displayName)})` : ""} with Zelle`}</div>
        <div>${venmo ? "Note" : "Memo"}: <strong style="font-family:monospace;font-size:16px;">${esc(order.id)}</strong></div>
        <ul style="margin:10px 0 0;padding-left:18px;">${steps.slice(venmo ? 1 : 2).map((s) => `<li>${esc(s)}</li>`).join("")}</ul>
        ${button}
      </div>
    </td></tr>`;
}

function htmlBody(order, pay) {
  const first = firstName(order);
  const awaiting = Boolean(pay);
  const font = "font-family:Helvetica,Arial,sans-serif;";
  const rows = order.lines
    .map(
      (l) => `<tr>
        <td style="${font}padding:10px 0;border-bottom:1px solid #eee;font-size:14px;color:#1b1b1f;">${esc(l.title || l.name)}<div style="font-size:12px;color:#888;">Qty ${esc(l.qty)} × ${money(l.price)}</div></td>
        <td style="${font}padding:10px 0;border-bottom:1px solid #eee;font-size:14px;color:#1b1b1f;text-align:right;white-space:nowrap;vertical-align:top;">${money(l.price * l.qty)}</td>
      </tr>`,
    )
    .join("");
  const total = (label, value, strong) =>
    `<tr><td style="${font}padding:4px 0;font-size:${strong ? 17 : 14}px;color:#1b1b1f;${strong ? "font-weight:bold;" : ""}">${label}</td><td style="${font}padding:4px 0;font-size:${strong ? 17 : 14}px;color:#1b1b1f;text-align:right;${strong ? "font-weight:bold;" : ""}">${value}</td></tr>`;
  const preheader = awaiting
    ? `Order #${esc(shortId(order.id))} is reserved. Send ${money(order.total)} with ${paidVia(order)} to complete it.`
    : `Order #${esc(shortId(order.id))} is confirmed. It usually ships within 1–2 business days.`;
  const intro = awaiting
    ? `<h1 style="font-family:Georgia,serif;margin:0 0 8px;font-size:24px;color:#1b1b1f;">Order received${first ? `, ${esc(first)}` : ""}!</h1>
      <p style="${font}margin:0;font-size:15px;line-height:1.5;color:#333;">Your order <strong>#${esc(shortId(order.id))}</strong> is reserved for you and waiting for your ${paidVia(order)} payment.</p>`
    : `<h1 style="font-family:Georgia,serif;margin:0 0 8px;font-size:24px;color:#1b1b1f;">Thank you${first ? `, ${esc(first)}` : ""}!</h1>
      <p style="${font}margin:0 0 6px;font-size:15px;line-height:1.5;color:#333;">Your order <strong>#${esc(shortId(order.id))}</strong> is confirmed and paid via ${paidVia(order)}.</p>
      <p style="${font}margin:0;font-size:15px;line-height:1.5;color:#333;">It usually ships within <strong>1–2 business days</strong>. We'll pack it carefully.</p>`;

  return `<!doctype html><html><body style="margin:0;padding:0;background:#f2efec;">
<div style="display:none;max-height:0;overflow:hidden;">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2efec;"><tr><td align="center" style="padding:24px 12px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;">
    <tr><td align="center" style="background:#0b0a0c;padding:24px 20px 18px;border-bottom:4px solid #ff5a1f;">
      <img src="${SITE}/brand/logo.jpg" width="120" height="120" alt="The PreEminent Store" style="display:block;border:0;border-radius:8px;">
    </td></tr>
    <tr><td style="padding:28px 28px 8px;">
      ${intro}
    </td></tr>
    ${awaiting ? paymentBox(order, pay, font) : ""}
    <tr><td style="padding:16px 28px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;">
        ${total("Subtotal", money(order.subtotal))}
        ${total("Shipping", Number(order.shipping) ? money(order.shipping) : "Free")}
        ${Number(order.tax) ? total(esc(taxName(order)), money(order.tax)) : ""}
        ${total("Total", money(order.total), true)}
      </table>
    </td></tr>
    <tr><td style="padding:20px 28px 0;">
      <div style="${font}background:#fff6f1;border:1px solid #f0c9b5;border-radius:8px;padding:12px 14px;font-size:14px;line-height:1.5;color:#1b1b1f;">
        <div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#b0400f;font-weight:bold;margin-bottom:4px;">Shipping to</div>
        ${addressLines(order.shipTo).map(esc).join("<br>")}
      </div>
    </td></tr>
    <tr><td style="padding:20px 28px 26px;">
      <p style="${font}margin:0 0 10px;font-size:12px;line-height:1.5;color:#666;">All sales are final, except damaged or wrong items reported within 3 days of delivery to <a href="mailto:${STORE_EMAIL}" style="color:#e8501c;">${STORE_EMAIL}</a>. Questions? Just reply to this email.</p>
    </td></tr>
    <tr><td align="center" style="${font}background:#0b0a0c;padding:16px 20px;font-size:12px;line-height:1.6;color:#cfc6bd;">
      <a href="${SITE}" style="color:#ffd27a;text-decoration:none;font-weight:bold;">preeminentstore.com</a><br>
      Instagram <a href="https://instagram.com/thepreeminentstore" style="color:#ff5a1f;text-decoration:none;">@thepreeminentstore</a> · YouTube <a href="https://youtube.com/@thezaiven" style="color:#ff5a1f;text-decoration:none;">@thezaiven</a><br>
      The PreEminent Store LLC
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
}

// Reserved test domains (RFC 2606) never get mail, so test checkouts can use e.g. buyer@example.com.
const TEST_ADDRESS = /@(?:[^@]+\.)?(?:example\.(?:com|net|org)|[^@]+\.(?:invalid|test))$/i;

async function send(env, order, { idempotencyKey, subject, pay }) {
  const customer = order.payer?.email;
  if (order.test || TEST_ADDRESS.test(customer || "")) return { sent: false, reason: "test order, email skipped" };
  if (!env.RESEND_API_KEY) return { sent: false, reason: "RESEND_API_KEY not set" };
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({
      from: `The PreEminent Store <${STORE_EMAIL}>`,
      to: [customer || STORE_EMAIL],
      ...(customer ? { bcc: [STORE_EMAIL] } : {}),
      reply_to: STORE_EMAIL,
      subject,
      html: htmlBody(order, pay),
      text: textBody(order, pay),
    }),
  });
  if (r.ok) return { sent: true, to: customer || STORE_EMAIL };
  const detail = await r.text().catch(() => "");
  console.log(`Order email failed (${r.status}): ${detail}`);
  return { sent: false, status: r.status, reason: detail.slice(0, 300) };
}

/** Sends the customer's paid order confirmation through Resend. Skips silently when RESEND_API_KEY isn't set. */
export function sendOrderEmail(env, order) {
  return send(env, order, { idempotencyKey: `order-${order.id}`, subject: `Order #${shortId(order.id)} confirmed - The PreEminent Store` });
}

/** "Order received, awaiting payment" with the Zelle/Venmo steps. pay: the method's public settings. */
export function sendAwaitingPaymentEmail(env, order, pay) {
  return send(env, order, {
    idempotencyKey: `awaiting-${order.id}`,
    subject: `Order #${shortId(order.id)} received - send ${money(order.total)} with ${paidVia(order)} to complete it`,
    pay,
  });
}
