// Test sessions written straight into D1 (local by default), in the same shape src/auth.js creates at sign-in:
// the cookie holds a random id, D1 holds its SHA-256 and the CSRF token.
import crypto from "node:crypto";
import { wrangler } from "./lib.mjs";
import { SESSION_COOKIE, sha256 } from "../src/auth.js";

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

/**
 * specs: [{ email, createdAgo = 0, idleAgo = 0 }] (seconds). One wrangler call for all rows.
 * Returns [{ email, id, cookie, csrf, hash }] in the same order.
 */
export async function createSessions(specs, { remote = false } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const out = [];
  for (const s of specs) {
    const id = crypto.randomBytes(32).toString("base64url");
    out.push({ email: s.email, id, cookie: `${SESSION_COOKIE}=${id}`, csrf: crypto.randomBytes(32).toString("base64url"), hash: await sha256(id), at: now - (s.createdAgo || 0), seen: now - (s.idleAgo || 0) });
  }
  const values = out.map((s) => `(${q(s.hash)}, ${q(s.email)}, ${q(s.csrf)}, ${s.at}, ${s.seen}, '', '', 'test-session')`).join(", ");
  wrangler(["d1", "execute", "DB", remote ? "--remote" : "--local", "--command", `INSERT INTO sessions (id_hash, email, csrf, created_at, last_seen_at, ip, country, ua) VALUES ${values}`]);
  return out;
}

export function deleteSessions(sessions, { remote = false } = {}) {
  if (!sessions.length) return;
  wrangler(["d1", "execute", "DB", remote ? "--remote" : "--local", "--command", `DELETE FROM sessions WHERE id_hash IN (${sessions.map((s) => q(s.hash)).join(", ")})`]);
}
