// Zelle and direct Venmo are manual payments: the order reserves stock right away and waits for the owner
// to see the money arrive. Settings come from the PC (data/store-settings.json "manualPayments"), pushed to
// KV as "manual-pay-config" with only the fields buyers may see (never the phone number or fee rates).

const ID_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export const METHODS = {
  zelle: { label: "Zelle", prefix: "Z" },
  venmo: { label: "Venmo", prefix: "V" },
};

const holdHours = (v) => (Number(v) > 0 ? Number(v) : 24);
const maxOrder = (v) => (Number(v) > 0 ? Number(v) : 2500);

/** Public settings per method; a method without its recipient (email / handle) is treated as off. */
export async function manualPayConfig(env) {
  const cfg = (await env.STORE.get("manual-pay-config", "json").catch(() => null)) || {};
  const z = cfg.zelle || {};
  const v = cfg.venmo || {};
  return {
    zelle: z.email
      ? { enabled: z.enabled !== false, email: String(z.email), displayName: String(z.displayName || ""), holdHours: holdHours(z.holdHours), maxOrder: maxOrder(z.maxOrder) }
      : { enabled: false },
    venmo: v.handle
      ? { enabled: v.enabled !== false, handle: String(v.handle).replace(/^@/, ""), holdHours: holdHours(v.holdHours), maxOrder: maxOrder(v.maxOrder) }
      : { enabled: false },
  };
}

export async function newOrderId(env, method) {
  for (;;) {
    const bytes = crypto.getRandomValues(new Uint8Array(7));
    const id = METHODS[method].prefix + [...bytes].map((b) => ID_CHARS[b % ID_CHARS.length]).join("");
    if (!(await env.STORE.get(`order:${id}`))) return id;
  }
}

export const isManual = (order) => Boolean(METHODS[order?.paymentMethod]);

export function restoreStock(stock, lines) {
  for (const l of lines) if (stock?.items?.[l.id]) stock.items[l.id].q += l.qty;
}

/**
 * Cancels unpaid manual orders the PC hasn't pulled yet (it expires the ones it has) and returns their stock,
 * so holds still lapse while the PC is off. Runs lazily from checkout.
 */
export async function expireStaleManualOrders(env) {
  const now = Date.now();
  let stock = null;
  for (const { prefix } of Object.values(METHODS)) {
    const { keys } = await env.STORE.list({ prefix: `order:${prefix}` });
    for (const { name } of keys) {
      const order = await env.STORE.get(name, "json");
      if (!isManual(order) || order.status !== "awaiting_payment" || Date.parse(order.expiresAt) > now) continue;
      stock ||= await env.STORE.get("stock", "json");
      restoreStock(stock, order.lines);
      await env.STORE.put(name, JSON.stringify({ ...order, status: "cancelled", cancelledAt: new Date().toISOString(), cancelReason: "expired" }));
    }
  }
  if (stock) await env.STORE.put("stock", JSON.stringify(stock));
}

export function venmoPayLink(handle, amount, note) {
  return `https://venmo.com/${encodeURIComponent(handle)}?txn=pay&amount=${Number(amount).toFixed(2)}&note=${encodeURIComponent(note)}`;
}
