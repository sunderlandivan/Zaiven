// Allowlist + roles (D1 "users" table) and the audit log. Every API route and page declares the lowest role it needs.
// A viewer sees exactly what staff see but is read-only: src/api.js refuses every non-GET request from a viewer,
// in shadow and active mode alike.
export const ROLES = ["viewer", "staff", "manager", "owner"];
const RANK = { viewer: 1, staff: 1, manager: 2, owner: 3 };
export const atLeast = (role, min) => (RANK[role] || 0) >= (RANK[min] || 99);
export const isReadOnly = (role) => role === "viewer";

/** Roles the owner can hand out on the Users page; "owner" only comes from the seed or OWNER_EMAILS. */
export const GRANTABLE = ["viewer", "staff", "manager"];

export const ownerEmails = (env) =>
  String(env.OWNER_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

const EMAIL_RE = /^[^\s@<>"'(),;:]+@[^\s@<>"'(),;:]+\.[a-z]{2,}$/i;

/** { email, role, name } for an allowed account, else null. OWNER_EMAILS stays owner even if the table row is lost. */
export async function findUser(env, email) {
  const e = String(email || "").trim().toLowerCase();
  if (!e) return null;
  const row = await env.DB.prepare("SELECT email, role, name FROM users WHERE email = ?").bind(e).first();
  if (ownerEmails(env).includes(e)) return { email: e, role: "owner", name: row?.name || "Owner" };
  return row && RANK[row.role] ? { email: row.email, role: row.role, name: row.name || "" } : null;
}

export async function noteLogin(env, email) {
  await env.DB.prepare("UPDATE users SET last_login_at = ? WHERE email = ?").bind(new Date().toISOString(), email).run();
}

export async function listUsers(env) {
  const { results } = await env.DB.prepare("SELECT email, role, name, added_by, added_at, last_login_at FROM users ORDER BY role = 'owner' DESC, email").all();
  const owners = ownerEmails(env);
  return results.map((u) => ({ ...u, protected: u.role === "owner" || owners.includes(u.email) }));
}

export async function saveUser(env, actor, input = {}) {
  const email = String(input.email || "").trim().toLowerCase();
  const role = String(input.role || "");
  const name = String(input.name || "").trim().slice(0, 80);
  if (!EMAIL_RE.test(email) || email.length > 200) throw Object.assign(new Error("Enter a valid Google account email."), { status: 400 });
  if (!GRANTABLE.includes(role)) throw Object.assign(new Error("Role must be viewer, staff or manager."), { status: 400 });
  const existing = await env.DB.prepare("SELECT role FROM users WHERE email = ?").bind(email).first();
  if (existing?.role === "owner" || ownerEmails(env).includes(email)) throw Object.assign(new Error("The owner account can't be changed here."), { status: 400 });
  await env.DB.prepare(
    "INSERT INTO users (email, role, name, added_by, added_at) VALUES (?, ?, ?, ?, ?) " +
      "ON CONFLICT(email) DO UPDATE SET role = excluded.role, name = excluded.name"
  )
    .bind(email, role, name, actor.email, new Date().toISOString())
    .run();
  return { email, role, name, created: !existing, previousRole: existing?.role || null };
}

export async function removeUser(env, email) {
  const e = String(email || "").trim().toLowerCase();
  const row = await env.DB.prepare("SELECT role FROM users WHERE email = ?").bind(e).first();
  if (!row) throw Object.assign(new Error("No such user."), { status: 404 });
  if (row.role === "owner" || ownerEmails(env).includes(e)) throw Object.assign(new Error("The owner account can't be removed."), { status: 400 });
  await env.DB.batch([env.DB.prepare("DELETE FROM users WHERE email = ?").bind(e), env.DB.prepare("DELETE FROM sessions WHERE email = ?").bind(e)]);
  return { removed: e, role: row.role };
}

export async function audit(env, { email = "", role = "", action, detail = "", status = null, ip = "" }) {
  await env.DB.batch([
    env.DB.prepare("INSERT INTO audit (at, email, role, action, detail, status, ip) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(
      new Date().toISOString(),
      String(email).slice(0, 200),
      role,
      String(action).slice(0, 80),
      String(detail).slice(0, 300),
      status,
      String(ip).slice(0, 64)
    ),
    env.DB.prepare("DELETE FROM audit WHERE id <= (SELECT MAX(id) - 5000 FROM audit)"),
  ]);
}

export async function auditPage(env, { page = 1, pageSize = 50, q = "" } = {}) {
  const size = Math.min(200, Math.max(1, Number(pageSize) || 50));
  const p = Math.max(1, Number(page) || 1);
  const like = `%${String(q).trim().slice(0, 80)}%`;
  const where = q ? "WHERE email LIKE ?1 OR action LIKE ?1 OR detail LIKE ?1" : "";
  const bind = (stmt, ...rest) => (q ? stmt.bind(like, ...rest) : stmt.bind(...rest));
  const [{ results }, total] = await Promise.all([
    bind(env.DB.prepare(`SELECT at, email, role, action, detail, status, ip FROM audit ${where} ORDER BY id DESC LIMIT ?${q ? 2 : 1} OFFSET ?${q ? 3 : 2}`), size, (p - 1) * size).all(),
    bind(env.DB.prepare(`SELECT COUNT(*) AS n FROM audit ${where}`)).first(),
  ]);
  return { entries: results, page: p, pageSize: size, total: total?.n || 0 };
}

// ---------- pages ----------

const PAGE_ROLES = {
  "/web-orders.html": "staff",
  "/inventory-orders.html": "staff",
  "/inventory-stock.html": "staff",
  "/order-doc.html": "staff",
  "/pc-only.html": "staff",
  "/inventory-import.html": "manager",
  "/inventory-analytics.html": "manager",
  "/inventory-dashboard-analytics.html": "manager",
  "/inventory-marketing.html": "manager",
  "/inventory-sheet-sync.html": "manager",
  "/sold-2026.html": "manager",
  "/inventory-tax-prep.html": "owner",
  "/inventory-loan.html": "owner",
  "/settings.html": "owner",
  "/status.html": "owner",
  "/users.html": "owner",
};
const SHARED_ASSET = /\.(css|js|png|svg|ico|woff2?)$/;

/** Lowest role allowed to load a static path. Unknown pages default to owner-only. */
export function pageRole(pathname) {
  if (PAGE_ROLES[pathname]) return PAGE_ROLES[pathname];
  if (SHARED_ASSET.test(pathname)) return "staff";
  return "owner";
}
