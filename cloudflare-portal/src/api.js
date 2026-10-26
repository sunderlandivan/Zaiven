// Every API route, the lowest role allowed to call it, and whether it is held back in shadow mode or PC-only.
// Paths and response shapes match the PC portal (server/index.js) so its pages run unchanged against D1/KV.
import { atLeast, audit, auditPage, isReadOnly, listUsers, removeUser, saveUser } from "./access.js";
import { IDLE_MINUTES, SESSION_HOURS, clientIp, listSessions, revokeSessions, sameOrigin, timingSafeEqual } from "./auth.js";
import { runTick } from "./cron.js";
import { listDocs, logActivity, readDoc, recentActivity, writeDoc } from "./docs.js";
import { GoogleBudget, sheetWritesEnabled } from "./google.js";
import { hostMode, leaseAction, leaseStatus, onShadow } from "./lease.js";
import { cancelManualOrder, currentStock, getRole, markManualOrderPaid, publishCycle, readStoreSettings, readWebOrders } from "./orders.js";
import { storeStockFor, stockViewFor, tcgOrderFor, webOrderFor } from "./redact.js";
import { decorateOrderShipment } from "../../server/shipmentKind.js";
import { mirrorSheet } from "./sheet.js";
import { inventoryDashboard, loanReport, paginate, salesTaxCsv, salesTaxReport, sheetRows, sheetSyncHealth, sheetSyncState, stockView, taxPrepReport } from "./views.js";

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const routes = [];
/** guard: "shadow" = refused until the cloud is the active host; "pc" = only the PC portal can do this today. */
const add = (method, path, min, handler, guard = null) => routes.push({ method, re: new RegExp(`^${path}$`), min, handler, guard });
const pcOnly = () => null;

const SHADOW_MESSAGE = "Read-only until switch-over: the PC portal is the active host. Use the PC portal for this for now.";
const PASSIVE_MESSAGE = "Passive: the cloud is in active mode but the PC portal still holds the lease. Request a handover on Cloud Status, or use the PC portal.";
const PC_MESSAGE = "Available on the PC portal.";

// ---------- identity ----------

add("GET", "/api/whoami", "staff", async ({ env, user }) => {
  const [mode, docs] = await Promise.all([getRole(env), listDocs(env)]);
  const copied = docs.filter((d) => d.source === "pc-migration").map((d) => d.updated_at).sort();
  return {
    email: user.email,
    name: user.name,
    role: user.role,
    readOnly: isReadOnly(user.role),
    authMode: user.mode,
    portalMode: await hostMode(env, mode.role),
    portalRole: mode.role,
    csrfToken: user.csrf,
    sessionHours: SESSION_HOURS,
    idleMinutes: IDLE_MINUTES,
    sessionEndsAt: new Date((user.createdAt + SESSION_HOURS * 3600) * 1000).toISOString(),
    dataCopiedAt: copied.at(-1) || null,
  };
});

// ---------- website orders ----------

const OPEN = (o) => o.status !== "cancelled" && (o.status === "paid" || !["zelle", "venmo"].includes(o.paymentMethod));

add("GET", "/api/store/web-orders", "staff", async ({ env, user, url }) => {
  const q = String(url.searchParams.get("q") || "").trim().toLowerCase();
  const status = url.searchParams.get("status") || "";
  let list = (await readWebOrders(env)).slice().reverse();
  if (status === "awaiting_payment" || status === "cancelled") list = list.filter((o) => o.status === status);
  else if (status === "to_ship") list = list.filter((o) => OPEN(o) && !o.shippingLabels?.length && !o.test);
  if (q) list = list.filter((o) => [o.id, o.shipTo?.name, ...(o.lines || []).map((l) => l.title || l.name)].join(" ").toLowerCase().includes(q));
  const page = paginate(list, { page: url.searchParams.get("page"), pageSize: url.searchParams.get("pageSize") || (list.length > 500 ? 500 : 0) });
  return { orders: page.items.map((o) => webOrderFor(user.role, o)), page: page.page, pageSize: page.pageSize, total: page.total };
});
add("GET", "/api/store/web-orders/([^/]+)", "staff", async ({ env, user, params }) => {
  const order = (await readWebOrders(env)).find((o) => o.id === decodeURIComponent(params[0]));
  if (!order) throw new HttpError(404, "Order not found.");
  return { order: webOrderFor(user.role, order) };
});
add(
  "POST",
  "/api/store/web-orders/([^/]+)/(mark-paid|cancel)",
  "manager",
  async ({ env, ctx, params }) => {
    const id = decodeURIComponent(params[0]);
    if (params[1] === "cancel") return cancelManualOrder(env, id);
    const result = await markManualOrderPaid(env, id);
    ctx.waitUntil(publishCycle(env).catch(() => {}));
    return result;
  },
  "shadow"
);
add("GET", "/api/store/kv-pending", "manager", async ({ env }) => (await readDoc(env, "kv-pending-orders", null)) || { count: 0, orders: [] });
add("GET", "/api/store/stock", "staff", async ({ env, user }) => ({ stock: storeStockFor(user.role, await currentStock(env)) }));
add("GET", "/api/store/publish", "owner", async ({ env }) => ({ ...(await readDoc(env, "store-publish-state", {})), webOrders: (await readWebOrders(env)).length }));
add("POST", "/api/store/publish", "owner", ({ env }) => publishCycle(env), "shadow");
add("POST", "/api/store/rebuild", "owner", pcOnly, "pc");

const SETTINGS_KEYS = ["contactEmail", "hideStatuses", "priceOverrides", "pricing", "shipping", "manualPayments", "salesTax"];
add("GET", "/api/store/settings", "owner", async ({ env }) => ({ settings: await readStoreSettings(env) }));
add(
  "PUT",
  "/api/store/settings",
  "owner",
  async ({ env, body }) => {
    const next = { ...(await readStoreSettings(env)) };
    for (const k of SETTINGS_KEYS) if (k in body) next[k] = body[k];
    await writeDoc(env, "store-settings", next);
    await logActivity(env, "settings", `store settings updated (${SETTINGS_KEYS.filter((k) => k in body).join(", ") || "nothing"})`);
    return { settings: next };
  },
  "shadow"
);

const DAY = /^\d{4}-\d{2}-\d{2}$/;
add("GET", "/api/store/sales-tax", "owner", async ({ env, url }) => {
  const from = DAY.test(url.searchParams.get("from") || "") ? url.searchParams.get("from") : "";
  const to = DAY.test(url.searchParams.get("to") || "") ? url.searchParams.get("to") : "";
  const report = await salesTaxReport(env, { from, to });
  if (url.searchParams.get("format") !== "csv") return report;
  return new Response(salesTaxCsv(report), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="sales-tax-${from || "start"}-to-${to || "today"}.csv"` },
  });
});

// ---------- TCGplayer / eBay orders (Order Tracking) ----------

add("GET", "/api/orders", "staff", async ({ env, user, url }) => {
  const all = (await readDoc(env, "orders-db", { orders: [] }))?.orders || [];
  const page = paginate(all, { page: url.searchParams.get("page"), pageSize: url.searchParams.get("pageSize") });
  return { orders: page.items.map((o) => tcgOrderFor(user.role, decorateOrderShipment(o))), page: page.page, pageSize: page.pageSize, total: page.total };
});
add(
  "POST",
  "/api/orders",
  "manager",
  async ({ env, body }) => {
    const db = (await readDoc(env, "orders-db", { orders: [] })) || { orders: [] };
    const order = {
      id: `ord_${Date.now()}`,
      productName: String(body.productName || "").trim(),
      quantity: Math.max(1, Math.round(Number(body.quantity) || 1)),
      salePrice: Number(body.salePrice || 0),
      platform: String(body.platform || "ebay").toLowerCase(),
      feeAmount: Number(body.feeAmount || 0),
      shippingCost: Number(body.shippingCost || 0),
      trackingNumber: String(body.trackingNumber || "").trim(),
      noTrackingNeeded: Boolean(body.noTrackingNeeded),
      purchaseDate: DAY.test(body.purchaseDate || "") ? body.purchaseDate : new Date().toISOString().slice(0, 10),
      createdAt: new Date().toISOString(),
      ...(Number(body.buyerTax) >= 0 && body.buyerTax !== undefined ? { buyerTax: Number(body.buyerTax) } : {}),
    };
    if (!order.productName) throw new HttpError(400, "Product name is required.");
    db.orders.unshift(order);
    await writeDoc(env, "orders-db", db);
    return { order };
  },
  "shadow"
);
add(
  "POST",
  "/api/orders/tracking-status",
  "staff",
  async ({ env, user, body }) => {
    const db = (await readDoc(env, "orders-db", { orders: [] })) || { orders: [] };
    const o = db.orders.find((x) => (body.orderId && String(x.id) === String(body.orderId)) || (body.orderNumber && String(x.orderNumber) === String(body.orderNumber)));
    if (!o) throw new HttpError(404, "Order not found.");
    Object.assign(o, { noTrackingNeeded: Boolean(body.noTrackingNeeded), stampAuto: false, updatedAt: new Date().toISOString() });
    if (o.noTrackingNeeded) o.trackingNumber = "";
    await writeDoc(env, "orders-db", db);
    return { order: tcgOrderFor(user.role, decorateOrderShipment(o)) };
  },
  "shadow"
);
add("POST", "/api/orders/import-csv", "manager", pcOnly, "pc");
add("GET", "/api/orders/gmail/status", "staff", () => ({ status: { connected: false, cloud: true } }));
add("GET", "/api/orders/gmail/auth/start", "owner", pcOnly, "pc");
add("POST", "/api/orders/gmail/(sync|disconnect)", "owner", pcOnly, "pc");

// ---------- inventory ----------

add("GET", "/api/inventory/stock", "staff", async ({ env, user }) => ({ data: stockViewFor(user.role, await stockView(env)) }));
add("GET", "/api/inventory/sales-matches", "staff", async ({ env, user }) => {
  if (!atLeast(user.role, "manager")) return { data: { unmatched: [], matched: [], ignored: [], itemOptions: [] } };
  const v = await stockView(env);
  return { data: { unmatched: v.unmatched, itemOptions: v.itemOptions } };
});
add("POST", "/api/inventory/sales-matches(/auto)?", "manager", pcOnly, "pc");
add("GET", "/api/inventory/dashboard", "manager", async ({ env }) => ({ data: await inventoryDashboard(env) }));
add("POST", "/api/inventory/(import|import-upload|refresh-prices|workflow|import-year-sheets)", "manager", pcOnly, "pc");
add("POST", "/api/reset/(inventory-workflow|orders)", "owner", pcOnly, "pc");

// ---------- Sheet Sync + Sold 2026 (Inventory26 / Sold 2026 only; Inventory25 / Sold 2025 are never read here) ----------

add("GET", "/api/sheet-sync", "manager", async ({ env }) => ({ data: await sheetSyncState(env) }));
add("GET", "/api/sheet-sync/health", "manager", async ({ env }) => ({ data: await sheetSyncHealth(env) }));
add("GET", "/api/sheet-sync/rows", "manager", async ({ env }) => {
  const { at, rows } = await sheetRows(env);
  return { at, data: rows.map((r) => ({ tab: r.tab, itemId: r.itemId, qty: r.qty, cost: r.cost, lastRetail: r.lastRetail, status: r.status })) };
});
add("POST", "/api/sheet-sync/mirror", "owner", ({ env }) => mirrorSheet(env, new GoogleBudget(10)));
add("POST", "/api/sheet-sync/(run|test)", "owner", pcOnly, "pc");
add("PUT", "/api/sheet-sync/settings", "owner", pcOnly, "pc");
add("POST", "/api/sheet-sync/events/[^/]+/(resolve|ignore)", "manager", pcOnly, "pc");
add("GET", "/api/sold", "manager", async ({ env, url }) => {
  const q = String(url.searchParams.get("q") || "").trim().toLowerCase();
  const { at, rows } = await sheetRows(env, "Sold 2026");
  const list = rows.filter((r) => !q || r.itemId.toLowerCase().includes(q)).reverse();
  const page = paginate(list, { page: url.searchParams.get("page"), pageSize: url.searchParams.get("pageSize") || 50 });
  const sum = (k) => Math.round(list.reduce((a, r) => a + Number(r[k] || 0) * (k === "cost" ? Number(r.qty || 1) : 1), 0) * 100) / 100;
  return { at, rows: page.items, page: page.page, pageSize: page.pageSize, total: page.total, totals: { units: list.reduce((a, r) => a + Number(r.qty || 0), 0), sold: sum("soldTotal"), cost: sum("cost"), fees: sum("fees"), shipping: sum("shipping") } };
});

// ---------- marketing ----------

add("GET", "/api/marketing/drafts", "manager", async ({ env }) => ({ drafts: ((await readDoc(env, "marketing-drafts", { drafts: [] }))?.drafts || []).slice().reverse() }));
add(
  "POST",
  "/api/marketing/drafts/([^/]+)",
  "manager",
  async ({ env, params, body }) => {
    const doc = (await readDoc(env, "marketing-drafts", { drafts: [] })) || { drafts: [] };
    const d = doc.drafts.find((x) => x.id === decodeURIComponent(params[0]));
    if (!d) throw new HttpError(404, "Draft not found.");
    if (body.status) {
      if (!["new", "approved", "rejected", "posted"].includes(body.status)) throw new HttpError(400, "Bad status.");
      d.status = body.status;
      d[`${body.status}At`] = new Date().toISOString();
    }
    if (typeof body.body === "string" && body.body !== d.body) d.editedBody = body.body;
    await writeDoc(env, "marketing-drafts", doc);
    return { draft: d };
  },
  "shadow"
);
add("GET", "/api/marketing/promo-shorts", "manager", () => ({ shorts: [], products: [], pcOnly: true }));
add("POST", "/api/marketing/promo-shorts", "manager", pcOnly, "pc");

// ---------- owner finances ----------

add("GET", "/api/tax-prep", "owner", async ({ env, url }) => ({ data: await taxPrepReport(env, url.searchParams.get("year")) }));
add("PUT", "/api/tax-prep/[^/]+", "owner", pcOnly, "pc");
add("POST", "/api/tax-prep/snapshot-inventory", "owner", pcOnly, "pc");
add("GET", "/api/loan", "owner", async ({ env }) => ({ data: await loanReport(env) }));
add("PUT", "/api/loan", "owner", pcOnly, "pc");
add("POST", "/api/loan/payments", "owner", pcOnly, "pc");
add("DELETE", "/api/loan/payments/[^/]+", "owner", pcOnly, "pc");
add("(GET|POST|PATCH|DELETE)", "/api/treasure-hunt(/.*)?", "manager", pcOnly, "pc");

// ---------- cloud portal admin ----------

add("GET", "/api/status", "owner", async ({ env }) => {
  const [role, cron, publish, kvPending, sheet, docs, activity, lease] = await Promise.all([
    getRole(env),
    readDoc(env, "cron-state", null),
    readDoc(env, "store-publish-state", {}),
    readDoc(env, "kv-pending-orders", null),
    readDoc(env, "sheet-snapshot-meta", null),
    listDocs(env),
    recentActivity(env, 30),
    leaseStatus(env),
  ]);
  return { role, cron, publish, kvPending, sheet, sheetWrites: sheetWritesEnabled(env), docs: docs.length, activity, lease };
});
add("GET", "/api/role", "owner", ({ env }) => getRole(env));
add("POST", "/api/role", "owner", async ({ env, user, body }) => {
  const role = body.role === "active" ? "active" : body.role === "shadow" ? "shadow" : null;
  if (!role) throw new HttpError(400, "role must be shadow or active");
  if (role === "active" && body.confirm !== "PC portal is stopped") {
    throw new HttpError(400, 'To make the cloud active, stop the PC portal first, then send confirm: "PC portal is stopped".');
  }
  const next = { role, since: new Date().toISOString(), by: user.email };
  await writeDoc(env, "portal-role", next);
  await logActivity(env, "role", `cloud portal set to ${role}`);
  const released = role === "shadow" ? await onShadow(env, user.email) : "";
  if (released) await logActivity(env, "lease", released);
  return { ...next, lease: released || undefined };
});
add("GET", "/api/lease", "owner", ({ env }) => leaseStatus(env));
// Owner only, CSRF and same-origin checked by handleApi like every write; each change also goes to the audit log.
add("POST", "/api/lease", "owner", async ({ env, user, body, note, ip }) => {
  const r = await leaseAction(env, String(body.action || ""), user.email);
  note(r.detail);
  await audit(env, { email: user.email, role: user.role, action: "lease handover", detail: r.detail, status: 200, ip });
  return r.status;
});
add("GET", "/api/docs", "owner", async ({ env }) => ({ docs: await listDocs(env) }));
add("GET", "/api/activity", "owner", async ({ env }) => ({ activity: await recentActivity(env, 100) }));
add("POST", "/api/cron/run", "owner", ({ env }) => runTick(env, Date.now(), { forceAll: true }));

add("GET", "/api/users", "owner", async ({ env }) => ({ users: await listUsers(env) }));
// A role change ends that person's sessions, so the new role applies from a fresh sign-in.
add("POST", "/api/users", "owner", async ({ env, user, body, note, ip }) => {
  const { previousRole, ...saved } = await saveUser(env, user, body);
  note(`${saved.created ? "added" : "updated"} ${saved.email} as ${saved.role}`);
  if (previousRole !== saved.role) {
    const { revoked } = saved.created ? { revoked: 0 } : await revokeSessions(env, saved.email);
    await audit(env, { email: user.email, role: user.role, action: "role change", detail: `${saved.email}: ${previousRole || "none"} -> ${saved.role}${revoked ? ` (${revoked} session(s) ended)` : ""}`, status: 200, ip });
  }
  return { user: saved };
});
add("DELETE", "/api/users/([^/]+)", "owner", async ({ env, user, params, note, ip }) => {
  const r = await removeUser(env, decodeURIComponent(params[0]));
  note(`removed ${r.removed}`);
  await audit(env, { email: user.email, role: user.role, action: "role change", detail: `${r.removed}: ${r.role} -> removed`, status: 200, ip });
  return r;
});
add("GET", "/api/audit", "owner", ({ env, url }) => auditPage(env, { page: url.searchParams.get("page"), pageSize: url.searchParams.get("pageSize"), q: url.searchParams.get("q") || "" }));
add("GET", "/api/sessions", "owner", async ({ env }) => ({ sessions: await listSessions(env), idleMinutes: IDLE_MINUTES, sessionHours: SESSION_HOURS }));
add("POST", "/api/sessions/revoke", "owner", async ({ env, body, note }) => {
  const email = String(body.email || "").trim().toLowerCase();
  const r = await revokeSessions(env, email);
  note(email ? `signed out ${email} (${r.revoked} session(s))` : `signed out everyone (${r.revoked} session(s))`);
  return r;
});

// ---------- dispatch ----------

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

export async function handleApi(request, env, ctx, user, url) {
  const method = request.method === "HEAD" ? "GET" : request.method;
  const path = url.pathname;
  let detail = "";
  let status = 200;
  const finish = (res) => {
    status = res.status;
    if (method !== "GET" || status === 403) {
      ctx.waitUntil(audit(env, { email: user.email, role: user.role, action: `${method} ${path}`.slice(0, 80), detail, status, ip: clientIp(request) }).catch(() => {}));
    }
    return res;
  };
  const write = method !== "GET";
  if (write && isReadOnly(user.role)) {
    detail = "read-only account";
    return finish(json({ ok: false, readOnlyAccount: true, error: "Your account is view-only." }, 403));
  }
  let params = null;
  const route = routes.find((r) => new RegExp(`^(?:${r.method})$`).test(method) && (params = path.match(r.re)));
  if (!route) return finish(json({ ok: false, error: "Not found" }, 404));
  if (!atLeast(user.role, route.min)) return finish(json({ ok: false, error: `Your role (${user.role}) can't use this.` }, 403));
  if (write && !sameOrigin(request)) {
    detail = "cross-site request";
    return finish(json({ ok: false, error: "Cross-site request blocked." }, 403));
  }
  if (write && !timingSafeEqual(request.headers.get("X-CSRF-Token") || "", user.csrf)) {
    detail = "missing or bad CSRF token";
    return finish(json({ ok: false, csrf: true, error: "Security token missing or expired. Reload the page and try again." }, 403));
  }
  if (route.guard === "pc") return finish(json({ ok: false, pcOnly: true, error: PC_MESSAGE }, 501));
  if (route.guard === "shadow") {
    const mode = await hostMode(env);
    if (mode !== "active") return finish(json({ ok: false, readOnly: true, passive: mode === "passive", error: mode === "passive" ? PASSIVE_MESSAGE : SHADOW_MESSAGE }, 409));
  }
  if (Number(request.headers.get("Content-Length") || 0) > 1_000_000) return finish(json({ ok: false, error: "Request too large." }, 413));
  try {
    const body = method === "GET" || method === "DELETE" ? {} : await request.json().catch(() => ({}));
    const out = await route.handler({ env, ctx, user, url, body, params: params.slice(1), note: (t) => (detail = t), ip: clientIp(request) });
    return finish(out instanceof Response ? out : json({ ok: true, ...out }));
  } catch (e) {
    return finish(json({ ok: false, error: e.message }, e.status || 400));
  }
}
