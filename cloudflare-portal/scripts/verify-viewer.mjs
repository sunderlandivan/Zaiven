// Live check that the viewer role can read but never write: a short-lived session for the seeded viewer is written to the
// remote D1, used for a few reads and refused writes (each with a valid CSRF token and Origin), then deleted.
import { PORTAL_URL } from "./lib.mjs";
import { createSessions, deleteSessions } from "./test-sessions.mjs";

const VIEWER = process.argv[2] || "pmissyann@gmail.com";
const sessions = await createSessions([{ email: VIEWER }], { remote: true });
const [{ cookie, csrf }] = sessions;
let failed = 0;
const out = (ok, msg) => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`);
};
const call = (p, method = "GET", body) =>
  fetch(PORTAL_URL + p, {
    method,
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
    headers: { Cookie: cookie, ...(method === "GET" ? {} : { Origin: PORTAL_URL, "X-CSRF-Token": csrf, "Content-Type": "application/json" }) },
    body: body ? JSON.stringify(body) : undefined,
  });

try {
  let r = await call("/api/whoami");
  const who = await r.json().catch(() => ({}));
  out(r.status === 200 && who.role === "viewer" && who.readOnly === true, `whoami -> ${r.status} role=${who.role} readOnly=${who.readOnly}`);
  r = await call("/web-orders.html");
  out(r.status === 200 && /frame-ancestors 'none'/.test(r.headers.get("content-security-policy") || ""), `viewer page /web-orders.html -> ${r.status} with CSP`);
  r = await call("/api/store/web-orders");
  out(r.status === 200, `viewer GET /api/store/web-orders -> ${r.status}`);
  r = await call("/vendor/chart.umd.min.js");
  out(r.status === 200 && /javascript/.test(r.headers.get("content-type") || ""), `self-hosted Chart.js -> ${r.status} ${r.headers.get("content-type")}`);
  r = await call("/users.html");
  out(r.status === 403, `viewer page /users.html -> ${r.status} (want 403)`);
  for (const [method, p, body] of [
    ["POST", "/api/orders/tracking-status", { orderNumber: "X", noTrackingNeeded: true }],
    ["POST", "/api/store/web-orders/INV-0001/mark-paid"],
    ["POST", "/api/users", { email: "x@example.com", role: "manager" }],
    ["POST", "/api/sessions/revoke", {}],
    ["POST", "/api/role", { role: "active", confirm: "PC portal is stopped" }],
    ["PUT", "/api/store/settings", { contactEmail: "x" }],
    ["DELETE", "/api/users/iv3nsun%40gmail.com"],
  ]) {
    r = await call(p, method, body);
    const j = await r.json().catch(() => ({}));
    out(r.status === 403 && j.readOnlyAccount === true, `viewer ${method} ${p} -> ${r.status} ${j.error || ""}`);
  }
} finally {
  deleteSessions(sessions, { remote: true });
}
const after = await fetch(`${PORTAL_URL}/api/whoami`, { headers: { Cookie: cookie }, signal: AbortSignal.timeout(15_000) });
out(after.status === 401, `test session deleted -> ${after.status}`);
console.log(failed ? `\n${failed} FAILED` : "\nviewer checks passed");
process.exit(failed ? 1 : 0);
