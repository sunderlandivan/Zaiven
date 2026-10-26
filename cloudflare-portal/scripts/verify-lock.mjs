// Signed-out sweep of the live portal: every page/asset must redirect to login, every API must be 401 with no data,
// and every response carries the security headers.
import crypto from "node:crypto";
import { PORTAL_URL } from "./lib.mjs";

const pages = [
  "/", "/index.html", "/web-orders.html", "/web-orders.js", "/inventory-orders.html", "/inventory-stock.html", "/order-doc.html",
  "/order-doc.html?type=invoice&id=INV-0001", "/pc-only.html", "/inventory-import.html", "/inventory-analytics.html",
  "/inventory-dashboard-analytics.html", "/inventory-marketing.html", "/inventory-sheet-sync.html", "/sold-2026.html",
  "/inventory-tax-prep.html", "/inventory-loan.html", "/settings.html", "/status.html", "/users.html", "/users.js",
  "/cloud.js", "/cloud.css", "/inventory.css", "/inventory.js", "/store/brand/mark.png", "/brand/logo.png", "/does-not-exist",
];
const apis = [
  ["GET", "/api/whoami"], ["GET", "/api/status"], ["GET", "/api/role"], ["POST", "/api/role"],
  ["GET", "/api/store/web-orders"], ["GET", "/api/store/web-orders/INV-0001"], ["POST", "/api/store/web-orders/INV-0001/mark-paid"],
  ["POST", "/api/store/web-orders/INV-0001/cancel"], ["GET", "/api/store/publish"], ["POST", "/api/store/publish"],
  ["GET", "/api/store/stock"], ["GET", "/api/store/kv-pending"], ["GET", "/api/store/settings"], ["PUT", "/api/store/settings"],
  ["GET", "/api/store/sales-tax"], ["POST", "/api/store/rebuild"],
  ["GET", "/api/orders"], ["POST", "/api/orders"], ["POST", "/api/orders/tracking-status"], ["GET", "/api/orders/gmail/status"],
  ["GET", "/api/inventory/stock"], ["GET", "/api/inventory/sales-matches"], ["GET", "/api/inventory/dashboard"],
  ["GET", "/api/sheet-sync"], ["GET", "/api/sheet-sync/health"], ["GET", "/api/sheet-sync/rows"], ["POST", "/api/sheet-sync/mirror"],
  ["GET", "/api/sold"], ["GET", "/api/marketing/drafts"], ["POST", "/api/marketing/drafts"], ["GET", "/api/marketing/promo-shorts"],
  ["GET", "/api/tax-prep?year=2026"], ["GET", "/api/loan"],
  ["GET", "/api/users"], ["POST", "/api/users"], ["DELETE", "/api/users/someone%40example.com"], ["GET", "/api/audit"],
  ["GET", "/api/docs"], ["GET", "/api/activity"], ["POST", "/api/cron/run"], ["GET", "/api/nope"],
];
const badCookies = [
  "", "pp_session=eyJlIjoiaXYzbnN1bkBnbWFpbC5jb20iLCJ4Ijo5OTk5OTk5OTk5fQ.forged",
  `__Host-pp_session=${crypto.randomBytes(32).toString("base64url")}`, "__Host-pp_session=iv3nsun@gmail.com",
];
// The sweep is a few hundred requests from one IP; wait out the portal's per-IP rate limit instead of failing.
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  for (;;) {
    const r = await realFetch(url, opts);
    if (r.status !== 429) return r;
    console.log("  (rate limited by the portal, waiting 60s)");
    await new Promise((res) => setTimeout(res, 61_000));
  }
};
const HEADER_RULES = {
  "content-security-policy": (v) => /script-src 'self'(;|$)/.test(v) && /style-src 'self'/.test(v) && /frame-ancestors 'none'/.test(v) && !/script-src[^;]*unsafe/.test(v),
  "strict-transport-security": (v) => Number((v.match(/max-age=(\d+)/) || [])[1]) >= 31536000,
  "x-frame-options": (v) => v === "DENY",
  "x-content-type-options": (v) => v === "nosniff",
  "referrer-policy": (v) => v === "no-referrer",
  "permissions-policy": (v) => /camera=\(\)/.test(v) && /geolocation=\(\)/.test(v),
};
const headerProblems = (r) => Object.entries(HEADER_RULES).filter(([h, ok]) => !ok(r.headers.get(h) || "")).map(([h]) => h);

let failed = 0;
const out = (ok, msg) => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`);
};

for (const cookie of badCookies) {
  const label = cookie ? "bad cookie" : "no cookie";
  for (const p of pages) {
    const r = await fetch(PORTAL_URL + p, { redirect: "manual", headers: cookie ? { Cookie: cookie } : {} });
    const body = await r.text();
    const hp = headerProblems(r);
    out(r.status === 302 && r.headers.get("location") === "/auth/login" && body.length === 0 && !hp.length, `${label} GET ${p} -> ${r.status} ${r.headers.get("location") || ""} body ${body.length}B${hp.length ? ` missing/weak: ${hp}` : ""}`);
  }
  for (const [method, p] of apis) {
    const r = await fetch(PORTAL_URL + p, {
      method,
      redirect: "manual",
      headers: { Origin: PORTAL_URL, "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
      body: method === "GET" ? undefined : JSON.stringify({ role: "active", confirm: "PC portal is stopped" }),
    });
    const body = await r.text();
    const hp = headerProblems(r);
    out(r.status === 401 && body === '{"ok":false,"error":"Sign in required."}' && !hp.length, `${label} ${method} ${p} -> ${r.status} ${body.slice(0, 60)}${hp.length ? ` missing/weak: ${hp}` : ""}`);
  }
}
const h = await fetch(`${PORTAL_URL}/health`);
const hb = await h.text();
out(h.status === 200 && hb === '{"ok":true}', `/health -> ${h.status} ${hb}`);
const login = await fetch(`${PORTAL_URL}/auth/login`, { redirect: "manual" });
const u = new URL(login.headers.get("location") || "http://x");
out(login.status === 302 && u.host === "accounts.google.com" && u.searchParams.get("redirect_uri") === `${PORTAL_URL}/auth/callback`, `/auth/login -> Google, redirect_uri ${u.searchParams.get("redirect_uri")}`);
out(Boolean(u.searchParams.get("state") && u.searchParams.get("nonce")) && u.searchParams.get("code_challenge_method") === "S256", "/auth/login sends state, nonce and PKCE S256");
out(/^__Host-pp_oauth=[^;]+; Max-Age=600; Path=\/; Secure; HttpOnly; SameSite=Lax$/.test(login.headers.get("set-cookie") || ""), "/auth/login state cookie is __Host-, Secure, HttpOnly, SameSite=Lax");
const cb = await fetch(`${PORTAL_URL}/auth/callback?code=x&state=y`, { redirect: "manual" });
out(cb.status === 400 && !/set-cookie/i.test([...cb.headers.keys()].join(",")), `/auth/callback with no state cookie -> ${cb.status}, no session cookie`);
console.log(failed ? `\n${failed} FAILED` : "\nall signed-out checks passed");
process.exit(failed ? 1 : 0);
