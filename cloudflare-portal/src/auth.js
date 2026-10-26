// Google sign-in (OAuth code flow with state + PKCE + nonce, id_token signature checked against Google's keys) and
// server-side sessions in D1. The cookie carries only a random id; D1 stores its SHA-256, the CSRF token and the
// timestamps, so deleting a row (sign-out, "sign out everyone", user removed) ends that session on the next request.
import { audit, findUser, noteLogin, ownerEmails } from "./access.js";
import { LOCKOUT_FAILS, LOCKOUT_MINUTES, auditOnce, lockedOut, refusedSignIns, sendAlert } from "./security.js";

export const SESSION_COOKIE = "__Host-pp_session";
const OAUTH_COOKIE = "__Host-pp_oauth";
const DEVICE_COOKIE = "__Host-pp_device";
const LEGACY_COOKIES = ["pp_session", "pp_state"];
export const SESSION_HOURS = 12;
export const IDLE_MINUTES = 120;
const TOUCH_SECONDS = 300;
const OAUTH_SECONDS = 600;
const DEVICE_DAYS = 400;
const ID_RE = /^[A-Za-z0-9_-]{43}$/;
const enc = new TextEncoder();

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const decodeJson = (s) => JSON.parse(new TextDecoder().decode(fromB64url(s)));
const randomId = () => b64url(crypto.getRandomValues(new Uint8Array(32)));
export const sha256 = async (s) => b64url(await crypto.subtle.digest("SHA-256", enc.encode(s)));
const nowSec = () => Math.floor(Date.now() / 1000);

const googleMode = (env) => Boolean(env.SESSION_SECRET && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
export const authConfigured = (env) => ownerEmails(env).length > 0 && googleMode(env);
export const clientIp = (request) => request.headers.get("CF-Connecting-IP") || "";

export function cookie(request, name) {
  const m = (request.headers.get("Cookie") || "").match(new RegExp(`(?:^|;\\s*)${name.replace(/[-]/g, "\\-")}=([^;]+)`));
  return m ? m[1] : "";
}

export function timingSafeEqual(a, b) {
  a = String(a);
  b = String(b);
  if (!a || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

// __Host- cookies: Secure, Path=/, no Domain, so no subdomain can set or read them. SameSite=Lax rather than Strict
// because Google's redirect back to /auth/callback is a cross-site navigation; writes are also CSRF-token protected.
const ATTRS = "Path=/; Secure; HttpOnly; SameSite=Lax";
const setCookie = (name, value, maxAge) => `${name}=${value}; Max-Age=${maxAge}; ${ATTRS}`;
const clearCookie = (name) => `${name}=; Max-Age=0; ${ATTRS}`;
const clearLegacy = (name) => `${name}=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax`;

// ---------- sessions ----------

export const hasSessionCookie = (request) => Boolean(cookie(request, SESSION_COOKIE));

/** { email, role, name, mode, csrf, sessionHash, createdAt, lastSeenAt } for a live session of an allowlisted user, else null. */
export async function authenticate(request, env, ctx) {
  if (!authConfigured(env)) return null;
  const raw = cookie(request, SESSION_COOKIE);
  if (!ID_RE.test(raw)) return null;
  const hash = await sha256(raw);
  const s = await env.DB.prepare("SELECT email, csrf, created_at, last_seen_at FROM sessions WHERE id_hash = ?").bind(hash).first();
  if (!s) return null;
  const now = nowSec();
  if (now - s.created_at > SESSION_HOURS * 3600 || now - s.last_seen_at > IDLE_MINUTES * 60) {
    ctx.waitUntil(env.DB.prepare("DELETE FROM sessions WHERE id_hash = ?").bind(hash).run().catch(() => {}));
    return null;
  }
  const user = await findUser(env, s.email);
  if (!user) return null;
  if (now - s.last_seen_at > TOUCH_SECONDS) {
    ctx.waitUntil(env.DB.prepare("UPDATE sessions SET last_seen_at = ? WHERE id_hash = ?").bind(now, hash).run().catch(() => {}));
  }
  return { ...user, mode: "google", csrf: s.csrf, sessionHash: hash, createdAt: s.created_at, lastSeenAt: now };
}

async function createSession(env, request, email) {
  const id = randomId();
  const now = nowSec();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE created_at < ? OR last_seen_at < ?").bind(now - SESSION_HOURS * 3600, now - IDLE_MINUTES * 60),
    env.DB.prepare("INSERT INTO sessions (id_hash, email, csrf, created_at, last_seen_at, ip, country, ua) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(
      await sha256(id),
      email,
      randomId(),
      now,
      now,
      clientIp(request).slice(0, 64),
      String(request.headers.get("CF-IPCountry") || "").slice(0, 4),
      String(request.headers.get("User-Agent") || "").slice(0, 200)
    ),
  ]);
  return id;
}

export async function listSessions(env) {
  const { results } = await env.DB.prepare("SELECT substr(id_hash, 1, 8) AS id, email, created_at, last_seen_at, ip, country, ua FROM sessions ORDER BY last_seen_at DESC LIMIT 200").all();
  const now = nowSec();
  return results
    .filter((s) => now - s.created_at <= SESSION_HOURS * 3600 && now - s.last_seen_at <= IDLE_MINUTES * 60)
    .map((s) => ({ ...s, created_at: new Date(s.created_at * 1000).toISOString(), last_seen_at: new Date(s.last_seen_at * 1000).toISOString() }));
}

/** Ends every session (email omitted) or one account's sessions. */
export async function revokeSessions(env, email = "") {
  const r = email
    ? await env.DB.prepare("DELETE FROM sessions WHERE email = ?").bind(String(email).trim().toLowerCase()).run()
    : await env.DB.prepare("DELETE FROM sessions").run();
  return { revoked: r.meta?.changes ?? 0 };
}

// ---------- Google id_token ----------

let googleKeys = { at: 0, keys: [] };
async function googleKey(kid) {
  if (Date.now() - googleKeys.at > 3600_000 || !googleKeys.keys.some((k) => k.kid === kid)) {
    const r = await fetch("https://www.googleapis.com/oauth2/v3/certs");
    if (r.ok) googleKeys = { at: Date.now(), keys: (await r.json()).keys || [] };
  }
  return googleKeys.keys.find((k) => k.kid === kid);
}

const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
const GMAIL_DOMAINS = ["gmail.com", "googlemail.com"];

/** { email } when the id_token is Google-signed for this client, unexpired, carries our nonce and a verified email; else { error }. */
export async function verifyIdToken(env, token, nonce, getKey = googleKey) {
  const [h, p, s] = String(token || "").split(".");
  if (!h || !p || !s) return { error: "no id_token" };
  let header;
  let c;
  try {
    header = decodeJson(h);
    c = decodeJson(p);
  } catch {
    return { error: "malformed id_token" };
  }
  if (header.alg !== "RS256") return { error: "unexpected algorithm" };
  const jwk = await getKey(header.kid);
  if (!jwk) return { error: "unknown signing key" };
  const key = await crypto.subtle.importKey("jwk", { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  if (!(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, fromB64url(s), enc.encode(`${h}.${p}`)))) return { error: "bad signature" };
  const now = Date.now() / 1000;
  const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
  if (!GOOGLE_ISSUERS.includes(c.iss)) return { error: "wrong issuer" };
  if (!aud.includes(env.GOOGLE_CLIENT_ID) || (c.azp && c.azp !== env.GOOGLE_CLIENT_ID)) return { error: "wrong audience" };
  if (!(Number(c.exp) > now - 60) || !(Number(c.iat) < now + 300)) return { error: "expired id_token" };
  if (!nonce || !timingSafeEqual(c.nonce || "", nonce)) return { error: "nonce mismatch" };
  if (c.email_verified !== true) return { error: "email not verified" };
  const email = String(c.email || "").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "no email" };
  const [local, domain] = email.split("@");
  // The allowlist is matched exactly. A Gmail address never has a "+" or a hosted domain in Google's own token, and a
  // Workspace account's hd must be the email's own domain.
  if (GMAIL_DOMAINS.includes(domain) && (c.hd || local.includes("+"))) return { error: "unexpected Gmail account", email };
  if (c.hd && String(c.hd).toLowerCase() !== domain) return { error: "hosted domain mismatch", email };
  return { email };
}

// ---------- routes ----------

const redirectUri = (env, url) => env.LOGIN_REDIRECT_URI || `${url.origin}/auth/callback`;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function page(status, title, text, { link = true, body = "", headers = {} } = {}) {
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title>
<body style="font-family:system-ui;max-width:28rem;margin:4rem auto;padding:0 1rem;background:#101317;color:#e8eef7"><h1 style="font-size:1.3rem">${esc(title)}</h1><p>${esc(text)}</p>${body}${
    link ? '<p><a style="color:#5ea2ff" href="/auth/login">Sign in with Google</a></p>' : ""
  }</body>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8", ...headers } });
}

/** POSTs must come from the portal's own pages. */
export function sameOrigin(request) {
  const origin = new URL(request.url).origin;
  const site = request.headers.get("Sec-Fetch-Site");
  if (site && site !== "same-origin") return false;
  const o = request.headers.get("Origin");
  if (o) return o === origin;
  const ref = request.headers.get("Referer") || "";
  return ref === origin || ref.startsWith(`${origin}/`);
}

async function signedOAuthCookie(env, data) {
  const body = b64url(enc.encode(JSON.stringify({ ...data, x: nowSec() + OAUTH_SECONDS })));
  return `${body}.${await hmac(env.SESSION_SECRET, body)}`;
}

async function readOAuthCookie(env, request) {
  const [body, sig] = cookie(request, OAUTH_COOKIE).split(".");
  if (!body || !sig || !timingSafeEqual(sig, await hmac(env.SESSION_SECRET, body))) return null;
  try {
    const d = decodeJson(body);
    return d.x > nowSec() ? d : null;
  } catch {
    return null;
  }
}

const lockedPage = () =>
  page(429, "Too many sign-in attempts", `Sign-in from this network is paused for ${LOCKOUT_MINUTES} minutes after repeated refused attempts.`, { link: false, headers: { "Retry-After": String(LOCKOUT_MINUTES * 60) } });

async function refuse(env, ctx, request, email, reason) {
  const ip = clientIp(request);
  const work = (async () => {
    await audit(env, { email, action: "sign-in refused", detail: reason, status: 403, ip });
    if ((await refusedSignIns(env, ip)) === LOCKOUT_FAILS) {
      await audit(env, { email, action: "sign-in lockout", detail: `${LOCKOUT_FAILS} refused sign-ins in ${LOCKOUT_MINUTES} min`, status: 429, ip });
      await sendAlert(env, "Repeated refused sign-ins", [
        `${LOCKOUT_FAILS} sign-ins were refused in ${LOCKOUT_MINUTES} minutes; sign-in from that network is paused for ${LOCKOUT_MINUTES} minutes.`,
        `Last account tried: ${email || "(none)"}`,
        `IP: ${ip}  Country: ${request.headers.get("CF-IPCountry") || "?"}`,
        "Review: https://portal.preeminentstore.com/users.html (Audit log).",
      ]);
    }
  })();
  ctx.waitUntil(work.catch(() => {}));
  return page(403, "Not allowed", "This Google account can't open the PreEminent portal. Ask the owner to add it on the Users page.");
}

async function noteDevice(env, ctx, request, user) {
  let device = cookie(request, DEVICE_COOKIE);
  if (!ID_RE.test(device)) device = randomId();
  const hash = await sha256(device);
  const at = new Date().toISOString();
  const known = await env.DB.prepare("SELECT 1 AS k FROM devices WHERE email = ? AND device_hash = ?").bind(user.email, hash).first();
  const work = (async () => {
    await env.DB.prepare("INSERT INTO devices (email, device_hash, first_seen, last_seen) VALUES (?, ?, ?, ?) ON CONFLICT(email, device_hash) DO UPDATE SET last_seen = excluded.last_seen")
      .bind(user.email, hash, at, at)
      .run();
    if (!known && user.role === "owner") {
      await sendAlert(env, "Owner sign-in from a new device", [
        `${user.email} signed in to the portal from a browser it hasn't used before.`,
        `When: ${at}`,
        `IP: ${clientIp(request)}  Country: ${request.headers.get("CF-IPCountry") || "?"}`,
        `Browser: ${String(request.headers.get("User-Agent") || "?").slice(0, 160)}`,
        "If this wasn't you: open Users & Audit, press \"Sign out everyone\", and change your Google password.",
      ]);
    }
  })();
  ctx.waitUntil(work.catch(() => {}));
  return device;
}

/** /auth/login, /auth/callback, /auth/logout, /auth/signed-out. Returns null for other paths. */
export async function handleAuthRoute(request, env, ctx) {
  const url = new URL(request.url);
  const ip = clientIp(request);

  if (url.pathname === "/auth/signed-out") return page(200, "Signed out", "You are signed out of the PreEminent portal.");

  if (url.pathname === "/auth/logout") {
    const user = await authenticate(request, env, ctx);
    if (request.method === "GET") {
      if (!user) return page(200, "Signed out", "You are signed out of the PreEminent portal.");
      return page(200, "Sign out?", `Signed in as ${user.email}.`, {
        link: false,
        body: `<form method="post" action="/auth/logout"><input type="hidden" name="csrf" value="${esc(user.csrf)}"><button type="submit">Sign out</button></form>`,
      });
    }
    if (request.method !== "POST") return page(405, "Not allowed", "Use the Sign out button.");
    if (user) {
      const form = await request.formData().catch(() => null);
      if (!sameOrigin(request) || !timingSafeEqual(form?.get("csrf") || "", user.csrf)) {
        auditOnce(env, ctx, { email: user.email, role: user.role, action: "sign-out blocked", detail: "missing or bad CSRF token", status: 403, ip });
        return page(403, "Sign-out blocked", "That sign-out request didn't come from the portal. Use the Sign out button.", { link: false });
      }
      await env.DB.prepare("DELETE FROM sessions WHERE id_hash = ?").bind(user.sessionHash).run();
      ctx.waitUntil(audit(env, { email: user.email, role: user.role, action: "sign-out", ip }).catch(() => {}));
    }
    const headers = new Headers({ Location: "/auth/signed-out" });
    headers.append("Set-Cookie", clearCookie(SESSION_COOKIE));
    return new Response(null, { status: 303, headers });
  }

  if (url.pathname === "/auth/login") {
    if (request.method !== "GET") return page(405, "Not allowed", "Open the sign-in link.");
    if (!googleMode(env)) return page(503, "Login not configured", "The portal's Google sign-in secrets are not set, so nobody can sign in.", { link: false });
    if (await lockedOut(env, ip)) return lockedPage();
    const state = randomId();
    const verifier = randomId();
    const nonce = randomId();
    const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    u.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
    u.searchParams.set("redirect_uri", redirectUri(env, url));
    u.searchParams.set("response_type", "code");
    u.searchParams.set("scope", "openid email");
    u.searchParams.set("state", state);
    u.searchParams.set("nonce", nonce);
    u.searchParams.set("code_challenge", await sha256(verifier));
    u.searchParams.set("code_challenge_method", "S256");
    u.searchParams.set("prompt", "select_account");
    const headers = new Headers({ Location: u.toString() });
    headers.append("Set-Cookie", setCookie(OAUTH_COOKIE, await signedOAuthCookie(env, { s: state, v: verifier, n: nonce }), OAUTH_SECONDS));
    return new Response(null, { status: 302, headers });
  }

  if (url.pathname === "/auth/callback") {
    if (request.method !== "GET") return page(405, "Not allowed", "Start the sign-in again.");
    if (!googleMode(env)) return page(503, "Login not configured", "Sign-in is not set up.", { link: false });
    if (await lockedOut(env, ip)) return lockedPage();
    const oauth = await readOAuthCookie(env, request);
    const state = url.searchParams.get("state") || "";
    if (!oauth || !timingSafeEqual(state, oauth.s)) {
      auditOnce(env, ctx, { action: "sign-in failed", detail: "missing or mismatched state", status: 400, ip });
      return page(400, "Sign-in expired", "Please start the sign-in again.");
    }
    if (url.searchParams.get("error")) return page(400, "Sign-in cancelled", "Google sign-in was cancelled.");
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: url.searchParams.get("code") || "",
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri(env, url),
        grant_type: "authorization_code",
        code_verifier: oauth.v,
      }),
    });
    const tok = await r.json().catch(() => ({}));
    if (!r.ok || !tok.id_token) {
      auditOnce(env, ctx, { action: "sign-in failed", detail: `token exchange ${r.status}`, status: 400, ip });
      return page(400, "Sign-in failed", "Google didn't confirm the sign-in. Please try again.");
    }
    const v = await verifyIdToken(env, tok.id_token, oauth.n);
    if (v.error) return refuse(env, ctx, request, v.email || "", v.error);
    const user = await findUser(env, v.email);
    if (!user) return refuse(env, ctx, request, v.email, "not on the allowlist");

    const old = cookie(request, SESSION_COOKIE);
    if (ID_RE.test(old)) await env.DB.prepare("DELETE FROM sessions WHERE id_hash = ?").bind(await sha256(old)).run();
    const session = await createSession(env, request, user.email);
    const device = await noteDevice(env, ctx, request, user);
    ctx.waitUntil(Promise.all([noteLogin(env, user.email), audit(env, { email: user.email, role: user.role, action: "sign-in", ip })]).catch(() => {}));
    const headers = new Headers({ Location: "/" });
    headers.append("Set-Cookie", setCookie(SESSION_COOKIE, session, SESSION_HOURS * 3600));
    headers.append("Set-Cookie", setCookie(DEVICE_COOKIE, device, DEVICE_DAYS * 86400));
    headers.append("Set-Cookie", clearCookie(OAUTH_COOKIE));
    for (const name of LEGACY_COOKIES) headers.append("Set-Cookie", clearLegacy(name));
    return new Response(null, { status: 303, headers });
  }
  return null;
}
