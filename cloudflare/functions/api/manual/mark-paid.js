import { json } from "../../../lib/store.js";
import { isManual } from "../../../lib/manualPay.js";
import { sendOrderEmail } from "../../../lib/orderEmail.js";

/**
 * Private (Bearer AGENT_TOKEN), called by the PC portal when the owner confirms a Zelle/Venmo payment arrived.
 * POST { order } — the PC's copy, since it usually pulled the KV record already. Sends the paid confirmation.
 */
export async function onRequestPost({ request, env }) {
  const auth = request.headers.get("Authorization") || "";
  if (!env.AGENT_TOKEN || auth !== `Bearer ${env.AGENT_TOKEN}`) return json({ error: "unauthorized" }, 401);
  const { order } = await request.json().catch(() => ({}));
  if (!isManual(order) || !Array.isArray(order.lines)) return json({ error: "Send { order } for a Zelle or Venmo order." }, 400);

  const paid = { ...order, status: "paid", paidAt: order.paidAt || new Date().toISOString() };
  const kvOrder = await env.STORE.get(`order:${order.id}`, "json");
  if (kvOrder) await env.STORE.put(`order:${order.id}`, JSON.stringify({ ...kvOrder, status: "paid", paidAt: paid.paidAt }));

  const email = await sendOrderEmail(env, paid);
  return json({ ok: true, email });
}
