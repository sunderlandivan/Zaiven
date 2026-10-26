// End-to-end checks against `wrangler dev --port 8788 --local` (local D1/KV only; Sheet writes are off in .dev.vars).
// Adds test staff, manager and viewer users and their sessions to the LOCAL D1 only, and removes them at the end.
// Usage: node scripts/smoke-test.mjs [--active]   (--active also runs the cut-over path with test orders in local KV)
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, wrangler } from "./lib.mjs";
import { createSessions } from "./test-sessions.mjs";
import { IDLE_MINUTES, SESSION_COOKIE, SESSION_HOURS } from "../src/auth.js";
import { HANDOVER_KEY, LEASE_KEY, LEASE_TTL_MS, claimLease, decideLease, releaseLease } from "../../server/portalLeaseCore.js";

const BASE = process.env.PORTAL_BASE || "http://localhost:8788";
const OWNER = "iv3nsun@gmail.com";
const STAFF = "staff.test@example.com";
const MANAGER = "manager.test@example.com";
const VIEWER = "viewer.test@example.com";
const TEMP = "temp.test@example.com";
const sql = (s) => wrangler(["d1", "execute", "DB", "--local", "--command", s]);
sql(
  `INSERT OR REPLACE INTO users (email, role, name, added_by, added_at) VALUES ('${STAFF}', 'staff', 'Test Staff', 'smoke-test', datetime('now')), ('${MANAGER}', 'manager', 'Test Manager', 'smoke-test', datetime('now')), ('${VIEWER}', 'viewer', 'Test Viewer', 'smoke-test', datetime('now'))`
);

// Every write sends the CSRF token of the session it uses, unless a test overrides it.
const csrfFor = new Map();
const [owner, staff, manager, viewer, missy, stranger, expired, idle, owner2, staffSpare] = (
  await createSessions([
    { email: OWNER },
    { email: STAFF },
    { email: MANAGER },
    { email: VIEWER },
    { email: "pmissyann@gmail.com" },
    { email: "someone@else.com" },
    { email: OWNER, createdAgo: SESSION_HOURS * 3600 + 60 },
    { email: OWNER, idleAgo: IDLE_MINUTES * 60 + 60 },
    { email: OWNER },
    { email: STAFF },
  ])
).map((s) => (csrfFor.set(s.cookie, s.csrf), s.cookie));
const forged = `${SESSION_COOKIE}=${crypto.randomBytes(32).toString("base64url")}`;
const legacy = `pp_session=${Buffer.from(JSON.stringify({ e: OWNER, x: 9999999999 })).toString("base64url")}.forged`;

let passed = 0;
let failed = 0;
function check(name, ok, detail = "") {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? `  (${detail})` : ""}`);
}

async function req(p, { cookie = owner, method = "GET", body, origin = BASE, csrf = csrfFor.get(cookie), headers: extra = {} } = {}) {
  const headers = { Cookie: cookie };
  if (method !== "GET") Object.assign(headers, { "Content-Type": "application/json" }, origin ? { Origin: origin } : {}, csrf ? { "X-CSRF-Token": csrf } : {});
  Object.assign(headers, extra);
  const send = () => fetch(BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined, redirect: "manual", signal: AbortSignal.timeout(15_000) });
  let t = Date.now();
  let r = await send();
  for (let tries = 0; r.status === 429 && tries < 2; tries++) {
    console.log("  (rate limited, waiting 60s)");
    await new Promise((res) => setTimeout(res, 61_000));
    t = Date.now();
    r = await send();
  }
  const text = await r.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* html */
  }
  return { status: r.status, json, text, ms: Date.now() - t, location: r.headers.get("location") || "", headers: r.headers };
}

const PAGES = {
  staff: ["/web-orders.html", "/inventory-orders.html", "/inventory-stock.html", "/order-doc.html", "/pc-only.html"],
  manager: ["/inventory-import.html", "/inventory-analytics.html", "/inventory-dashboard-analytics.html", "/inventory-marketing.html", "/inventory-sheet-sync.html", "/sold-2026.html"],
  owner: ["/inventory-tax-prep.html", "/inventory-loan.html", "/settings.html", "/status.html", "/users.html"],
};
const GET_APIS = {
  staff: ["/api/whoami", "/api/store/web-orders", "/api/store/stock", "/api/orders", "/api/orders/gmail/status", "/api/inventory/stock", "/api/inventory/sales-matches"],
  manager: ["/api/store/kv-pending", "/api/inventory/dashboard", "/api/sheet-sync", "/api/sheet-sync/health", "/api/sheet-sync/rows", "/api/sold", "/api/marketing/drafts", "/api/marketing/promo-shorts"],
  owner: ["/api/tax-prep?year=2026", "/api/tax-prep?year=2025", "/api/loan", "/api/store/settings", "/api/store/sales-tax", "/api/store/publish", "/api/status", "/api/role", "/api/lease", "/api/docs", "/api/activity", "/api/users", "/api/audit"],
};

// --- signed-out gate ---
check("health is public", (await req("/health", { cookie: "" })).status === 200);
for (const p of ["/", ...Object.values(PAGES).flat(), "/cloud.js", "/inventory.css", "/nope.html"]) {
  const r = await req(p, { cookie: "" });
  check(`signed out: ${p} redirects to login`, r.status === 302 && r.location === "/auth/login" && r.text.length === 0, `${r.status} ${r.location}`);
}
for (const p of Object.values(GET_APIS).flat()) {
  const r = await req(p, { cookie: "" });
  check(`signed out: ${p} is 401 with no data`, r.status === 401 && r.text === '{"ok":false,"error":"Sign in required."}', `${r.status} ${r.text.slice(0, 60)}`);
}
for (const [label, cookie] of Object.entries({ forged, stranger, expired, idle, legacy })) {
  check(`${label} session is 401`, (await req("/api/store/web-orders", { cookie })).status === 401);
}
check("not-allowlisted session is refused for pages too", (await req("/web-orders.html", { cookie: stranger })).location === "/auth/login");
let r = await req("/auth/login", { cookie: "" });
const loginUrl = new URL(r.location || "http://x");
const lp = loginUrl.searchParams;
check("login goes to Google with openid email scope", r.status === 302 && loginUrl.host === "accounts.google.com" && lp.get("scope") === "openid email" && /\/\/portal\.preeminentstore\.com\/auth\/callback$/.test(lp.get("redirect_uri") || ""));
check("login sends state, nonce and a PKCE S256 challenge", /^[\w-]{43}$/.test(lp.get("state") || "") && /^[\w-]{43}$/.test(lp.get("nonce") || "") && lp.get("code_challenge_method") === "S256" && /^[\w-]{43}$/.test(lp.get("code_challenge") || "") && lp.get("state") !== lp.get("nonce"));
check("login state cookie is __Host-, HttpOnly, Secure, SameSite=Lax, 10 min", /^__Host-pp_oauth=[^;]+; Max-Age=600; Path=\/; Secure; HttpOnly; SameSite=Lax$/.test(r.headers.get("set-cookie") || ""), r.headers.get("set-cookie"));
check("login page has the security headers", /frame-ancestors 'none'/.test(r.headers.get("content-security-policy") || ""));
check("callback with bad state is rejected", (await req("/auth/callback?code=x&state=y", { cookie: "__Host-pp_oauth=z.y" })).status === 400);
check("callback with no state cookie is rejected and sets no session", !(r = await req("/auth/callback?code=x&state=y", { cookie: "" })).headers.get("set-cookie") && r.status === 400);
check("login by POST is refused", (await req("/auth/login", { cookie: "", method: "POST" })).status === 405);

// --- security headers (every response type) ---
const HEADER_RULES = {
  "content-security-policy": (v) => /default-src 'self'/.test(v) && /script-src 'self'(;|$)/.test(v) && /style-src 'self'/.test(v) && /frame-ancestors 'none'/.test(v) && /object-src 'none'/.test(v) && /base-uri 'none'/.test(v) && /form-action 'self'/.test(v) && !/script-src[^;]*unsafe/.test(v),
  "strict-transport-security": (v) => /max-age=(\d+)/.test(v) && Number(v.match(/max-age=(\d+)/)[1]) >= 31536000,
  "x-frame-options": (v) => v === "DENY",
  "x-content-type-options": (v) => v === "nosniff",
  "referrer-policy": (v) => ["no-referrer", "same-origin", "strict-origin-when-cross-origin"].includes(v),
  "permissions-policy": (v) => /camera=\(\)/.test(v) && /geolocation=\(\)/.test(v) && /microphone=\(\)/.test(v),
  "cache-control": (v) => v === "no-store",
};
for (const [label, opts, p] of [
  ["signed-out redirect", { cookie: "" }, "/"],
  ["signed-out API 401", { cookie: "" }, "/api/whoami"],
  ["owner page", {}, "/web-orders.html"],
  ["owner script", {}, "/cloud.js"],
  ["owner API", {}, "/api/whoami"],
  ["role-blocked page", { cookie: staff }, "/users.html"],
  ["health", { cookie: "" }, "/health"],
]) {
  const x = await req(p, opts);
  const bad = Object.entries(HEADER_RULES).filter(([h, ok]) => !ok(x.headers.get(h) || "")).map(([h]) => `${h}=${x.headers.get(h)}`);
  check(`security headers on ${label}`, bad.length === 0, bad.join(" | "));
}
r = await req("/cloud.js");
check("scripts served as JavaScript (nosniff-safe)", /javascript/.test(r.headers.get("content-type") || ""));
r = await req("/inventory.css");
check("styles served as CSS (nosniff-safe)", /text\/css/.test(r.headers.get("content-type") || ""));
for (const p of ["/order-doc.html", "/pc-only.html", "/web-orders.html", "/users.html", "/inventory-orders.html"]) {
  const x = await req(p);
  check(`${p} has no inline script the CSP would block`, !/\son[a-z]+\s*=|<script(?![^>]*\bsrc=)[^>]*>/i.test(x.text));
}

// --- owner ---
r = await req("/api/whoami");
check("owner signs in as owner", r.json?.role === "owner" && r.json?.email === OWNER && r.json?.portalMode === "shadow" && r.json?.readOnly === false, JSON.stringify(r.json));
check("whoami hands the page its CSRF token and the 12 h limit", r.json?.csrfToken === csrfFor.get(owner) && r.json?.sessionHours === 12);
check("security headers set", r.headers.get("x-frame-options") === "DENY" && /noindex/.test(r.headers.get("x-robots-tag") || "") && r.headers.get("cache-control") === "no-store");
check("/ goes to Web Orders", (await req("/")).location === "/web-orders.html");
for (const p of Object.values(PAGES).flat()) check(`owner page ${p}`, (await req(p)).status === 200);
const timings = [];
for (const p of Object.values(GET_APIS).flat()) {
  const x = await req(p);
  timings.push(`${p} ${x.ms}ms`);
  check(`owner GET ${p}`, x.status === 200 && x.json?.ok !== false, `${x.status} ${x.text.slice(0, 80)}`);
}
check("cross-site POST blocked", (await req("/api/users", { method: "POST", body: { email: "x@y.com", role: "staff" }, origin: "https://evil.example" })).status === 403);

// --- CSRF ---
const csrfProbe = { method: "POST", body: { email: "csrf.probe@example.com", role: "staff" } };
const csrfCases = {
  "no CSRF token": { csrf: null },
  "wrong CSRF token": { csrf: crypto.randomBytes(32).toString("base64url") },
  "another session's CSRF token": { csrf: csrfFor.get(owner2) },
  "truncated CSRF token": { csrf: csrfFor.get(owner).slice(0, 20) },
  "no Origin or Referer": { origin: null },
  "lookalike Origin": { origin: `${BASE}.evil.example` },
  "Sec-Fetch-Site cross-site": { headers: { "Sec-Fetch-Site": "cross-site" } },
  "Sec-Fetch-Site same-site (sibling subdomain)": { headers: { "Sec-Fetch-Site": "same-site" } },
};
for (const [label, opts] of Object.entries(csrfCases)) {
  const x = await req("/api/users", { ...csrfProbe, ...opts });
  check(`CSRF: ${label} -> 403`, x.status === 403 && x.json?.ok === false, `${x.status} ${x.text.slice(0, 80)}`);
}
for (const [method, p] of [["PUT", "/api/store/settings"], ["DELETE", `/api/users/${encodeURIComponent(STAFF)}`], ["POST", "/api/sessions/revoke"], ["POST", "/api/role"], ["POST", "/api/cron/run"], ["POST", "/api/lease"]]) {
  check(`CSRF: ${method} ${p} without token -> 403`, (await req(p, { method, csrf: null, body: { role: "shadow" } })).status === 403);
}
check("CSRF: Referer alone (no Origin) from the portal is accepted", (await req("/api/users", { ...csrfProbe, origin: null, headers: { Referer: `${BASE}/users.html` } })).status === 200);
check("CSRF: probe user cleanup", (await req(`/api/users/${encodeURIComponent("csrf.probe@example.com")}`, { method: "DELETE" })).status === 200);
check("CSRF: staff user untouched by refused DELETE", (await req("/api/whoami", { cookie: staff })).json?.role === "staff");
const logoutForm = (cookie, csrf, headers = {}) =>
  fetch(`${BASE}/auth/logout`, { method: "POST", redirect: "manual", headers: { Cookie: cookie, Origin: BASE, "Content-Type": "application/x-www-form-urlencoded", ...headers }, body: new URLSearchParams(csrf ? { csrf } : {}) });
let lo = await logoutForm(staffSpare, "");
check("CSRF: sign-out without token is refused and keeps the session", lo.status === 403 && (await req("/api/whoami", { cookie: staffSpare })).status === 200);
lo = await logoutForm(staffSpare, csrfFor.get(staffSpare), { Origin: "https://evil.example" });
check("CSRF: cross-site sign-out is refused", lo.status === 403);
r = await req("/auth/logout");
check("GET /auth/logout only shows a confirm form", r.status === 200 && /name="csrf"/.test(r.text) && (await req("/api/whoami")).status === 200);

// --- data ---
const wo = await req("/api/store/web-orders");
const pcWeb = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "web-orders.json"), "utf8")).orders.length;
check("web orders migrated", wo.json?.orders?.length === pcWeb, `${wo.json?.orders?.length} vs PC ${pcWeb}`);
r = await req("/api/store/web-orders?page=1&pageSize=2");
check("web orders paginate", r.json?.orders?.length <= 2 && r.json?.total === pcWeb && r.json?.pageSize === 2);
r = await req("/api/inventory/stock");
check("stock view computed", r.json?.data?.items?.length > 0 && r.json.data.items.some((i) => "unitCost" in i), `${r.json?.data?.items?.length} items`);
r = await req("/api/tax-prep?year=2026");
check("tax prep report", Array.isArray(r.json?.data?.sales) && r.json.data.totals && r.json.data.year === "2026");
r = await req("/api/sheet-sync");
check("sheet settings exclude Inventory25", r.json?.data?.settings?.stockTabs?.every((t) => !/25$/.test(t)) && r.json?.data?.settings?.purchaseTab === "Inventory26");

// --- staff ---
r = await req("/api/whoami", { cookie: staff });
check("staff signs in as staff", r.json?.role === "staff", JSON.stringify(r.json));
for (const p of PAGES.staff) check(`staff page ${p}`, (await req(p, { cookie: staff })).status === 200);
for (const p of [...PAGES.manager, ...PAGES.owner]) check(`staff blocked from page ${p}`, (await req(p, { cookie: staff })).status === 403);
for (const p of GET_APIS.staff) check(`staff GET ${p}`, (await req(p, { cookie: staff })).status === 200);
for (const p of [...GET_APIS.manager, ...GET_APIS.owner]) {
  const x = await req(p, { cookie: staff });
  check(`staff blocked from ${p}`, x.status === 403 && !/"data"|"orders"|"settings"|"users"/.test(x.text), `${x.status} ${x.text.slice(0, 60)}`);
}
const MONEY_KEYS = /"(total|subtotal|tax|taxInfo|price|payer|captureId|paypalFee|paymentFee|invoiceUrl|salePrice|feeAmount|orderAmount|shippingCost|buyerTax|unitCost|totalInv|profitPerUnit|profitTotal|marginPct|feePerUnit|grandTotalInv|estProfit|f)":/;
for (const p of ["/api/store/web-orders", "/api/orders", "/api/inventory/stock", "/api/store/stock"]) {
  const x = await req(p, { cookie: staff });
  const { page, pageSize, total, ...records } = x.json || {};
  const m = JSON.stringify(records).match(MONEY_KEYS);
  check(`staff sees no money/payment fields in ${p}`, x.status === 200 && !m, m?.[0]);
}
const oneId = wo.json?.orders?.[0]?.id;
if (oneId) {
  const x = await req(`/api/store/web-orders/${encodeURIComponent(oneId)}`, { cookie: staff });
  check("staff order detail keeps ship-to, drops payment", Boolean(x.json?.order?.shipTo) && !MONEY_KEYS.test(x.text));
}
check("staff tracking update refused in shadow", (await req("/api/orders/tracking-status", { cookie: staff, method: "POST", body: { orderNumber: "X" } })).status === 409);
check("staff can't mark paid", (await req("/api/store/web-orders/X/mark-paid", { cookie: staff, method: "POST" })).status === 403);
check("staff can't add users", (await req("/api/users", { cookie: staff, method: "POST", body: { email: "a@b.com", role: "manager" } })).status === 403);
check("staff can't change mode", (await req("/api/role", { cookie: staff, method: "POST", body: { role: "shadow" } })).status === 403);
check("staff can't run cron", (await req("/api/cron/run", { cookie: staff, method: "POST" })).status === 403);

// --- manager ---
r = await req("/api/whoami", { cookie: manager });
check("manager signs in as manager", r.json?.role === "manager");
for (const p of [...PAGES.staff, ...PAGES.manager]) check(`manager page ${p}`, (await req(p, { cookie: manager })).status === 200);
for (const p of PAGES.owner) check(`manager blocked from page ${p}`, (await req(p, { cookie: manager })).status === 403);
for (const p of GET_APIS.manager) check(`manager GET ${p}`, (await req(p, { cookie: manager })).status === 200);
for (const p of GET_APIS.owner) check(`manager blocked from ${p}`, (await req(p, { cookie: manager })).status === 403);
r = await req("/api/store/web-orders", { cookie: manager });
check("manager sees totals but no PayPal ids", /"total":/.test(r.text) && !/"captureId"|"invoiceUrl"|"paypalFee"/.test(r.text));

// --- viewer (read-only; sees the staff view, every write refused server-side) ---
r = await req("/api/whoami", { cookie: viewer });
check("viewer signs in as viewer, flagged read-only", r.json?.role === "viewer" && r.json?.readOnly === true, JSON.stringify(r.json));
check("Missy is seeded as a viewer", (await req("/api/whoami", { cookie: missy })).json?.role === "viewer");
for (const p of PAGES.staff) check(`viewer page ${p}`, (await req(p, { cookie: viewer })).status === 200);
for (const p of [...PAGES.manager, ...PAGES.owner]) check(`viewer blocked from page ${p}`, (await req(p, { cookie: viewer })).status === 403);
for (const p of GET_APIS.staff) check(`viewer GET ${p}`, (await req(p, { cookie: viewer })).status === 200);
for (const p of [...GET_APIS.manager, ...GET_APIS.owner]) check(`viewer blocked from ${p}`, (await req(p, { cookie: viewer })).status === 403);
for (const p of ["/api/store/web-orders", "/api/orders", "/api/inventory/stock"]) {
  const [v, s] = [await req(p, { cookie: viewer }), await req(p, { cookie: staff })];
  check(`viewer sees exactly the staff view of ${p}`, v.status === 200 && v.text === s.text);
}
// Every mutating route the Worker knows, plus unknown ones: all 403 for a viewer, with a valid CSRF token and Origin.
const WRITES = [
  ["POST", "/api/orders/tracking-status", { orderNumber: "X", noTrackingNeeded: true }],
  ["POST", "/api/orders", { productName: "x" }],
  ["POST", "/api/orders/import-csv"],
  ["POST", "/api/orders/gmail/sync"],
  ["POST", "/api/orders/gmail/disconnect"],
  ["POST", "/api/store/web-orders/INV-0001/mark-paid"],
  ["POST", "/api/store/web-orders/INV-0001/cancel"],
  ["POST", "/api/store/publish"],
  ["POST", "/api/store/rebuild"],
  ["PUT", "/api/store/settings", { contactEmail: "x" }],
  ["POST", "/api/inventory/sales-matches"],
  ["POST", "/api/inventory/sales-matches/auto"],
  ["POST", "/api/inventory/import"],
  ["POST", "/api/inventory/refresh-prices"],
  ["POST", "/api/reset/orders"],
  ["POST", "/api/sheet-sync/mirror"],
  ["POST", "/api/sheet-sync/run"],
  ["PUT", "/api/sheet-sync/settings"],
  ["POST", "/api/sheet-sync/events/x/resolve"],
  ["POST", "/api/marketing/drafts/x", { status: "approved" }],
  ["POST", "/api/marketing/promo-shorts"],
  ["PUT", "/api/tax-prep/sales"],
  ["POST", "/api/tax-prep/snapshot-inventory"],
  ["PUT", "/api/loan"],
  ["POST", "/api/loan/payments"],
  ["DELETE", "/api/loan/payments/x"],
  ["POST", "/api/treasure-hunt/scan"],
  ["PATCH", "/api/treasure-hunt/x"],
  ["POST", "/api/role", { role: "shadow" }],
  ["POST", "/api/lease", { action: "take" }],
  ["POST", "/api/cron/run"],
  ["POST", "/api/users", { email: "x@y.com", role: "manager" }],
  ["DELETE", `/api/users/${encodeURIComponent(STAFF)}`],
  ["POST", "/api/sessions/revoke", {}],
  ["POST", "/api/does-not-exist"],
  ["PUT", "/api/whoami"],
];
for (const [method, p, body] of WRITES) {
  const x = await req(p, { cookie: viewer, method, body });
  check(`viewer ${method} ${p} -> 403`, x.status === 403 && x.json?.readOnlyAccount === true, `${x.status} ${x.text.slice(0, 80)}`);
}
check("viewer write to a page path is refused", (await req("/web-orders.html", { cookie: viewer, method: "POST" })).status === 405);
r = await req("/api/role", { method: "POST", body: { role: "active", confirm: "PC portal is stopped" } });
check("switch to active for the viewer check (local)", r.json?.role === "active");
for (const [method, p, body] of WRITES.slice(0, 2)) {
  check(`viewer ${method} ${p} -> 403 in active mode too`, (await req(p, { cookie: viewer, method, body })).status === 403);
}
check("back to shadow", (await req("/api/role", { method: "POST", body: { role: "shadow" } })).json?.role === "shadow");
check("other sessions untouched by the viewer's refused revoke", (await req("/api/whoami", { cookie: staff })).status === 200);
r = await req(`/api/audit?q=${encodeURIComponent(VIEWER)}`);
check("audit logged the viewer's refused writes", r.json?.entries?.filter((e) => e.status === 403 && e.detail === "read-only account").length >= 10);

// --- shadow mode and PC-only ---
check("mark-paid refused in shadow", (await req("/api/store/web-orders/X/mark-paid", { cookie: manager, method: "POST" })).status === 409);
check("publish refused in shadow", (await req("/api/store/publish", { method: "POST" })).status === 409);
check("settings save refused in shadow", (await req("/api/store/settings", { method: "PUT", body: { contactEmail: "x" } })).status === 409);
check("manual order refused in shadow", (await req("/api/orders", { cookie: manager, method: "POST", body: { productName: "x" } })).status === 409);
check("draft update refused in shadow", (await req("/api/marketing/drafts/x", { cookie: manager, method: "POST", body: { status: "approved" } })).status === 409);
check("sheet run is PC-only", (await req("/api/sheet-sync/run", { method: "POST" })).status === 501);
check("price refresh is PC-only", (await req("/api/inventory/refresh-prices", { cookie: manager, method: "POST" })).status === 501);
check("tax prep edit is PC-only", (await req("/api/tax-prep/sales", { method: "PUT", body: {} })).status === 501);
check("active needs explicit confirmation", (await req("/api/role", { method: "POST", body: { role: "active" } })).status === 400);
check("still shadow", (await req("/api/role")).json?.role === "shadow");

// --- users + audit ---
r = await req("/api/users", { method: "POST", body: { email: TEMP, role: "staff", name: "Temp" } });
check("owner adds an employee", r.json?.user?.created === true);
let [temp, temp2] = (await createSessions([{ email: TEMP }, { email: TEMP }])).map((s) => (csrfFor.set(s.cookie, s.csrf), s.cookie));
check("new employee can sign in as staff", (await req("/api/whoami", { cookie: temp })).json?.role === "staff");
r = await req("/api/users", { method: "POST", body: { email: TEMP, role: "manager" } });
check("owner changes role", r.json?.user?.role === "manager" && !("previousRole" in r.json.user));
check("role change ends that person's sessions", (await req("/api/whoami", { cookie: temp })).status === 401 && (await req("/api/whoami", { cookie: temp2 })).status === 401);
check("role change leaves other people's sessions alone", (await req("/api/whoami", { cookie: staff })).status === 200);
[temp] = (await createSessions([{ email: TEMP }])).map((s) => (csrfFor.set(s.cookie, s.csrf), s.cookie));
check("after signing in again the new role applies", (await req("/api/whoami", { cookie: temp })).json?.role === "manager");
r = await req("/api/users", { method: "POST", body: { email: TEMP, role: "viewer" } });
check("owner can make someone a viewer", r.json?.user?.role === "viewer");
r = await req(`/api/audit?q=${encodeURIComponent("role change")}`);
check("audit has role-change entries", r.json?.entries?.some((e) => e.action === "role change" && /temp\.test@example\.com: staff -> manager/.test(e.detail)) && r.json.entries.some((e) => /manager -> viewer/.test(e.detail)));
[temp] = (await createSessions([{ email: TEMP }])).map((s) => (csrfFor.set(s.cookie, s.csrf), s.cookie));
check("owner role can't be granted", (await req("/api/users", { method: "POST", body: { email: "x@y.com", role: "owner" } })).status === 400);
check("owner can't be removed", (await req("/api/users/iv3nsun%40gmail.com", { method: "DELETE" })).status === 400);
check("owner can't be demoted", (await req("/api/users", { method: "POST", body: { email: "iv3nsun@gmail.com", role: "staff" } })).status === 400);
check("bad email rejected", (await req("/api/users", { method: "POST", body: { email: "not-an-email", role: "staff" } })).status === 400);
r = await req(`/api/users/${encodeURIComponent(TEMP)}`, { method: "DELETE" });
check("owner removes employee", r.json?.removed === TEMP);
check("removed employee is signed out at once", (await req("/api/whoami", { cookie: temp })).status === 401);
r = await req(`/api/audit?q=${encodeURIComponent(TEMP)}`);
check("audit logged the user changes", r.json?.entries?.some((e) => /added temp\.test/.test(e.detail)) && r.json.entries.some((e) => /removed temp\.test/.test(e.detail)));
check("audit logged the removal as a role change", r.json?.entries?.some((e) => e.action === "role change" && /viewer -> removed/.test(e.detail)));
check("viewer role can't be smuggled to owner", (await req("/api/users", { method: "POST", body: { email: "pmissyann@gmail.com", role: "owner" } })).status === 400);
r = await req("/api/audit?q=staff.test");
check("audit logged staff's refused actions", r.json?.entries?.some((e) => e.status === 403));
r = await req("/api/users");
const real = r.json?.users?.filter((u) => ![STAFF, MANAGER, VIEWER].includes(u.email)) || [];
check("real users are the owner and Missy (viewer), plus local test accounts", real.map((u) => `${u.email}:${u.role}`).join() === "iv3nsun@gmail.com:owner,pmissyann@gmail.com:viewer", JSON.stringify(real.map((u) => `${u.email}:${u.role}`)));

// --- cron (KV peek + read-only Sheet mirror) ---
r = await req("/api/cron/run", { method: "POST" });
check("cron tick ran", r.status === 200 && !r.json?.error, JSON.stringify({ err: r.json?.error, sheetErr: r.json?.sheetError }));
const rows = await req("/api/sheet-sync/rows");
const tabs = [...new Set((rows.json?.data || []).map((x) => x.tab))];
check("sheet mirror holds only Inventory26 / Sold 2026", tabs.length > 0 && tabs.every((t) => t === "Inventory26" || t === "Sold 2026"), tabs.join(", "));
r = await req("/api/sold?pageSize=5");
check("Sold 2026 paginated", r.json?.rows?.length <= 5 && r.json?.total >= r.json?.rows?.length);
r = await req("/__scheduled?cron=*/5+*+*+*+*", { cookie: "" });
check("scheduled handler fires", r.status === 200, r.text.slice(0, 60));

// --- host lease (local KV only): shadow never claims, active without the lease is passive, handover, hand back ---
const LEASE_PC = { host: "pc", id: "pc:SMOKE-TEST" };
const kvPut = (k, v) => wrangler(["kv", "key", "put", k, JSON.stringify(v), "--binding", "STORE", "--local"]);
const kvDel = (k) => {
  try {
    wrangler(["kv", "key", "delete", k, "--binding", "STORE", "--local"]);
  } catch {
    /* already gone */
  }
};
const leaseNow = async () => (await req("/api/lease")).json || {};
const leaseOp = (action, opts = {}) => req("/api/lease", { method: "POST", body: { action }, ...opts });
const resetLease = () => {
  kvDel(LEASE_KEY);
  kvDel(HANDOVER_KEY);
  sql("DELETE FROM doc_parts WHERE name = 'lease-last-write'; DELETE FROM docs WHERE name = 'lease-last-write'");
};
resetLease();
let ls = await leaseNow();
check("lease: none yet, cloud in shadow", ls.lease?.present === false && ls.mode === "shadow" && ls.me === "cloud:preeminent-portal", JSON.stringify(ls));
for (const [label, cookie] of Object.entries({ staff, manager, viewer })) {
  check(`lease: ${label} can't change it`, (await leaseOp("take", { cookie })).status === 403);
  check(`lease: ${label} can't read it`, (await req("/api/lease", { cookie })).status === 403);
}
check("lease: owner without CSRF token -> 403", (await leaseOp("take", { csrf: null })).status === 403);
check("lease: owner cross-site -> 403", (await leaseOp("take", { origin: "https://evil.example" })).status === 403);
check("lease: unknown action -> 400", (await leaseOp("grab")).status === 400);
check("lease: shadow can't request a handover", (await leaseOp("request")).status === 409);
check("lease: shadow can't force-take", (await leaseOp("take")).status === 409);
r = await req("/api/cron/run", { method: "POST" });
check("lease: shadow cron never claims a missing lease", r.json?.lease?.holder === false && (await leaseNow()).lease?.present === false, JSON.stringify(r.json?.lease));
kvPut(LEASE_KEY, releaseLease(LEASE_PC, "cloud", Date.now()));
r = await req("/api/cron/run", { method: "POST" });
ls = await leaseNow();
check("lease: shadow cron hands a lease given to the cloud back to the PC", r.json?.lease?.state === "released" && ls.lease?.host === "pc" && ls.lease?.holder === null, JSON.stringify(ls.lease));

const pcHeld = claimLease(LEASE_PC, Date.now());
kvPut(LEASE_KEY, pcHeld);
check("lease: make active (local) while the PC holds the lease", (await req("/api/role", { method: "POST", body: { role: "active", confirm: "PC portal is stopped" } })).json?.role === "active");
r = await req("/api/whoami");
check("lease: active mode without the lease reports passive", r.json?.portalMode === "passive" && r.json?.portalRole === "active", JSON.stringify({ m: r.json?.portalMode, r: r.json?.portalRole }));
r = await req("/api/cron/run", { method: "POST" });
check("lease: passive cron peeks but doesn't publish", r.json?.lease?.holder === false && !r.json?.publish && typeof r.json?.peek?.count === "number", JSON.stringify(r.json?.lease));
check("lease: passive cron leaves the PC's lease alone", (await leaseNow()).lease?.holder === LEASE_PC.id);
r = await req("/api/store/publish", { method: "POST" });
check("lease: passive publish refused (409, passive)", r.status === 409 && r.json?.passive === true, `${r.status} ${r.text.slice(0, 80)}`);
check("lease: passive mark-paid refused", (await req("/api/store/web-orders/X/mark-paid", { cookie: manager, method: "POST" })).status === 409);
check("lease: passive settings save refused", (await req("/api/store/settings", { method: "PUT", body: { contactEmail: "x" } })).status === 409);
check("lease: force take refused over a live PC lease", (await leaseOp("take")).status === 409);
check("lease: hand back refused when the cloud doesn't hold it", (await leaseOp("release")).status === 409);
r = await leaseOp("request");
check("lease: owner requests a handover", r.status === 200 && r.json?.handover?.to === "cloud" && r.json?.handover?.pending === true && r.json?.mode === "passive", `${r.status} ${r.text.slice(0, 120)}`);
const handover = r.json?.handover;
check("lease: owner cancels a pending request", (await leaseOp("cancel")).status === 200 && !(await leaseNow()).handover);
r = await leaseOp("request");
check("lease: request again", r.json?.handover?.pending === true);
r = await req(`/api/audit?q=${encodeURIComponent("lease handover")}`);
check("lease: audit logged the request and the cancel", r.json?.entries?.some((e) => /handover to cloud requested/.test(e.detail)) && r.json.entries.some((e) => /request cancelled/.test(e.detail)));
const pcSide = decideLease({ lease: pcHeld, handover: (await leaseNow()).handover || handover, me: LEASE_PC });
check("lease: the PC's own rules release on that request", pcSide.state === "released" && pcSide.write?.host === "cloud" && pcSide.write?.holder === null);
kvPut(LEASE_KEY, pcSide.write);
r = await req("/api/cron/run", { method: "POST" });
ls = await leaseNow();
check("lease: cloud claims the handed-over lease on its next tick", r.json?.lease?.state === "claimed" && ls.lease?.mine === true && ls.mode === "active" && !ls.handover, JSON.stringify(ls));
check("lease: whoami now reports active", (await req("/api/whoami")).json?.portalMode === "active");
check("lease: the PC's rules now stay passive (cloud in charge)", decideLease({ lease: { ...ls.lease, claimedAt: ls.lease?.updatedAt }, me: LEASE_PC }).holder === false);
const cloudHeld = { host: "cloud", holder: ls.lease?.holder, preferred: "cloud", claimedAt: ls.lease?.updatedAt, expiresAt: ls.lease?.expiresAt, updatedAt: ls.lease?.updatedAt, by: ls.lease?.by };
r = await leaseOp("release");
ls = await leaseNow();
check("lease: owner hands back to the PC", r.status === 200 && ls.lease?.host === "pc" && ls.lease?.holder === null && ls.mode === "passive", JSON.stringify(ls.lease));
kvPut(LEASE_KEY, cloudHeld);
r = await req("/api/cron/run", { method: "POST" });
check("lease: a stale KV read of the cloud's old lease doesn't revive it (D1 copy wins)", r.json?.lease?.holder === false && !r.json?.publish && (await leaseNow()).lease?.holder === null, JSON.stringify(r.json?.lease));
kvPut(LEASE_KEY, releaseLease({ host: "cloud", id: cloudHeld.holder }, "pc", Date.parse(ls.lease?.updatedAt), ls.lease?.by));
check("lease: publish refused again after handing back", (await req("/api/store/publish", { method: "POST" })).status === 409);
check("lease: force take refused while the lease waits for the PC", (await leaseOp("take")).status === 409);
// The PC claimed after the hand-back, then stopped: its last write is newer than the cloud's, but the lease has expired.
const expiredPc = { ...claimLease(LEASE_PC, Date.now() - LEASE_TTL_MS - 60_000), updatedAt: new Date().toISOString() };
kvPut(LEASE_KEY, expiredPc);
r = await req("/api/cron/run", { method: "POST" });
check("lease: active cloud doesn't grab an expired PC lease (PC preferred)", r.json?.lease?.state === "expired" && r.json?.lease?.holder === false, JSON.stringify(r.json?.lease));
r = await leaseOp("take");
check("lease: owner force-takes the expired lease", r.status === 200 && r.json?.lease?.mine === true, `${r.status} ${r.text.slice(0, 120)}`);
r = await req(`/api/audit?q=${encodeURIComponent("force-taken")}`);
check("lease: audit logged the force take", r.json?.entries?.some((e) => e.action === "lease handover" && /force-taken by the cloud \(was pc:SMOKE-TEST, expired\)/.test(e.detail)));

// --- optional: the active-host path, local KV + test orders only (the cloud holds the lease from the section above) ---
if (process.argv.includes("--active")) {
  const stockItems = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "store-stock.json"), "utf8")).items;
  const [itemId, item] = Object.entries(stockItems).find(([, it]) => it.q > 2);
  const t0 = new Date();
  const line = { id: itemId, qty: 1, name: item.n, title: item.t, single: item.s === "single", price: item.p };
  const zelle = { id: "SMOKE-Z1", test: true, paymentMethod: "zelle", status: "awaiting_payment", total: item.p, shipping: 0, createdAt: t0.toISOString(), expiresAt: new Date(t0.getTime() + 3600_000).toISOString(), lines: [line], payer: { name: "Test Buyer" }, shipTo: { name: "Test Buyer", address: {} } };
  const venmo = { ...zelle, id: "SMOKE-V1", paymentMethod: "venmo" };
  for (const o of [zelle, venmo]) wrangler(["kv", "key", "put", `order:${o.id}`, JSON.stringify(o), "--binding", "STORE", "--local"]);
  r = await req("/api/role", { method: "POST", body: { role: "active", confirm: "PC portal is stopped" } });
  check("switch to active (local)", r.json?.role === "active");
  r = await req("/api/store/publish", { method: "POST" });
  check("publish pulled the test orders", r.json?.newOrders === 2, JSON.stringify(r.json));
  r = await req(`/api/store/web-orders/SMOKE-Z1/mark-paid`, { cookie: manager, method: "POST" });
  check("manager marks paid (test order, no email)", r.json?.order?.status === "paid" && r.json?.email?.sent === false, JSON.stringify(r.json?.email));
  r = await req(`/api/store/web-orders/SMOKE-V1/cancel`, { cookie: manager, method: "POST" });
  check("manager cancels", r.json?.order?.status === "cancelled");
}
r = await req("/api/role", { method: "POST", body: { role: "shadow" } });
ls = await leaseNow();
check("back to shadow hands the lease back to the PC", r.json?.role === "shadow" && /handed back/.test(r.json?.lease || "") && ls.lease?.host === "pc" && ls.lease?.holder === null && ls.mode === "shadow", JSON.stringify(ls.lease));
resetLease();

// --- sessions: list, sign-out, sign out one account, sign out everyone (owner only) ---
r = await req("/api/sessions");
check("owner lists sessions (no raw ids)", r.status === 200 && r.json?.sessions?.length >= 3 && r.json.sessions.every((s) => s.id.length === 8) && r.json.sessionHours === 12);
check("staff can't list sessions", (await req("/api/sessions", { cookie: staff })).status === 403);
check("manager can't sign everyone out", (await req("/api/sessions/revoke", { cookie: manager, method: "POST", body: {} })).status === 403);
lo = await logoutForm(staffSpare, csrfFor.get(staffSpare));
check("sign-out with token ends the session and clears the cookie", lo.status === 303 && /^__Host-pp_session=; Max-Age=0; Path=\/; Secure; HttpOnly; SameSite=Lax/.test(lo.headers.get("set-cookie") || "") && (await req("/api/whoami", { cookie: staffSpare })).status === 401);
check("sign-out left the same user's other session alone", (await req("/api/whoami", { cookie: staff })).status === 200);
r = await req("/api/sessions/revoke", { method: "POST", body: { email: MANAGER } });
check("owner signs out one account", r.json?.revoked >= 1 && (await req("/api/whoami", { cookie: manager })).status === 401 && (await req("/api/whoami", { cookie: staff })).status === 200);
r = await req("/api/sessions/revoke", { cookie: owner2, method: "POST", body: {} });
check("owner signs out everyone", r.status === 200 && r.json?.revoked >= 3);
check("after sign out everyone: every session is dead", (await Promise.all([owner, owner2, staff, viewer, missy].map((c) => req("/api/whoami", { cookie: c })))).every((x) => x.status === 401));
r = await req(`/api/audit?q=${encodeURIComponent("signed out everyone")}`, { cookie: (await createSessions([{ email: OWNER }]).then(([s]) => (csrfFor.set(s.cookie, s.csrf), s.cookie))) });
check("sign out everyone is in the audit log", r.json?.entries?.some((e) => /signed out everyone/.test(e.detail)));

sql(`DELETE FROM users WHERE email IN ('${STAFF}', '${MANAGER}', '${VIEWER}', '${TEMP}')`);
sql("DELETE FROM sessions WHERE ua = 'test-session'");
console.log(`\nAPI timings (local, wall clock): ${timings.join(", ")}`);
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
