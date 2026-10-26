// Abuse controls shared by the auth routes and the API: per-IP rate limits, sign-in lockout, de-duplicated audit
// rows for blocked traffic, and owner email alerts (Resend free tier, capped well under its 100/day).
import { audit, ownerEmails } from "./access.js";

export const LOCKOUT_FAILS = 5;
export const LOCKOUT_MINUTES = 15;
const ALERTS_PER_DAY = 20;

const since = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString();

export async function refusedSignIns(env, ip) {
  if (!ip) return 0;
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit WHERE ip = ? AND action = 'sign-in refused' AND at > ?").bind(ip, since(LOCKOUT_MINUTES)).first();
  return row?.n || 0;
}

export const lockedOut = async (env, ip) => (await refusedSignIns(env, ip)) >= LOCKOUT_FAILS;

// A flood of bad requests writes at most one audit row per IP and reason per minute (per Worker isolate),
// so attackers can't burn the D1 write budget or bury real entries.
const lastLogged = new Map();
export function auditOnce(env, ctx, entry) {
  const key = `${entry.ip}|${entry.action}`;
  const now = Date.now();
  if (now - (lastLogged.get(key) || 0) < 60_000) return;
  if (lastLogged.size > 5000) lastLogged.clear();
  lastLogged.set(key, now);
  ctx.waitUntil(audit(env, entry).catch(() => {}));
}

/** True when this key is over the limit of the given Workers rate-limiting binding (counted by Cloudflare, not D1/KV). */
export async function overLimit(env, binding, key) {
  const limiter = env[binding];
  if (!limiter || !key) return false;
  try {
    return !(await limiter.limit({ key })).success;
  } catch {
    return false;
  }
}

export async function sendAlert(env, subject, lines) {
  const to = ownerEmails(env)[0];
  if (!env.RESEND_API_KEY || !to) return { sent: false, reason: "alerts not configured" };
  const today = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit WHERE action = 'alert sent' AND at > ?").bind(since(24 * 60)).first();
  if ((today?.n || 0) >= ALERTS_PER_DAY) return { sent: false, reason: "daily alert cap reached" };
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.ALERT_FROM, to: [to], subject: `[PreEminent portal] ${subject}`, text: lines.join("\n") }),
  });
  await audit(env, { action: r.ok ? "alert sent" : "alert failed", detail: subject, status: r.status });
  return { sent: r.ok };
}
