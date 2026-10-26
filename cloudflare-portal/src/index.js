import { atLeast, pageRole } from "./access.js";
import { handleApi } from "./api.js";
import { authConfigured, authenticate, clientIp, handleAuthRoute, hasSessionCookie } from "./auth.js";
import { runTick } from "./cron.js";
import { auditOnce, overLimit } from "./security.js";

// No inline scripts anywhere (scripts/build-ui.mjs moves the PC pages' few inline handlers into cloud.js), so
// script-src is 'self' only. Inline style attributes are still used by the PC pages, hence style-src 'unsafe-inline'.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "connect-src 'self'",
  "frame-src 'none'",
  "worker-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

const SECURITY_HEADERS = {
  "Content-Security-Policy": CSP,
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=(), browsing-topics=()",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Permitted-Cross-Domain-Policies": "none",
  "X-Robots-Tag": "noindex, nofollow",
  "Cache-Control": "no-store",
};

function withHeaders(res) {
  const r = new Response(res.body, res);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) r.headers.set(k, v);
  return r;
}

const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...headers } });
const fail = (status, error) => json({ ok: false, error }, status);
const HOME = "/web-orders.html";
const LOCAL = new Set(["localhost", "127.0.0.1"]);

function forbiddenPage(user) {
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Not available</title>
<body style="font-family:system-ui;max-width:28rem;margin:4rem auto;padding:0 1rem;background:#101317;color:#e8eef7"><h1 style="font-size:1.3rem">Not available for your role</h1>
<p>You're signed in as a ${user.role}. Ask the owner if you need this page.</p><p><a style="color:#5ea2ff" href="${HOME}">Back to the portal</a></p></body>`;
  return new Response(html, { status: 403, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

function tooMany(env, ctx, request, url) {
  auditOnce(env, ctx, { action: "rate limited", detail: url.pathname.slice(0, 120), status: 429, ip: clientIp(request) });
  const headers = { "Retry-After": "60" };
  if (url.pathname.startsWith("/api/")) return json({ ok: false, error: "Too many requests. Wait a minute and try again." }, 429, headers);
  return new Response("Too many requests. Wait a minute and try again.", { status: 429, headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" } });
}

async function handle(request, env, ctx) {
  const url = new URL(request.url);
  // LOCAL_DEV is set only in .dev.vars: `wrangler dev` presents requests as http://<custom domain>.
  if (url.protocol === "http:" && !LOCAL.has(url.hostname) && env.LOCAL_DEV !== "1") {
    url.protocol = "https:";
    return new Response(null, { status: 301, headers: { Location: url.toString() } });
  }
  if (url.pathname === "/health") return json({ ok: true });
  const ip = clientIp(request);

  if (url.pathname.startsWith("/auth/")) {
    if (await overLimit(env, "RL_AUTH", ip)) return tooMany(env, ctx, request, url);
    return (await handleAuthRoute(request, env, ctx)) || fail(404, "Not found");
  }
  if (await overLimit(env, "RL_API", ip)) return tooMany(env, ctx, request, url);

  // Weekly Short handed to Instagram by URL (fallback upload method): public but unguessable, and the PC writes
  // the KV key with a 2-hour TTL and deletes it right after publishing.
  const media = url.pathname.match(/^\/media\/short\/([a-f0-9]{48})\.mp4$/);
  if (media && ["GET", "HEAD"].includes(request.method)) {
    const body = await env.STORE.get(`short-media:${media[1]}`, "arrayBuffer");
    if (!body) return fail(404, "Not found");
    return new Response(request.method === "HEAD" ? null : body, { headers: { "Content-Type": "video/mp4", "Content-Length": String(body.byteLength) } });
  }

  const user = await authenticate(request, env, ctx);
  if (!user) {
    if (hasSessionCookie(request)) auditOnce(env, ctx, { action: "session rejected", detail: "expired, revoked or forged session cookie", status: 401, ip });
    if (url.pathname.startsWith("/api/")) return fail(401, authConfigured(env) ? "Sign in required." : "Portal login is not configured.");
    return new Response(null, { status: 302, headers: { Location: "/auth/login" } });
  }

  if (url.pathname.startsWith("/api/")) return handleApi(request, env, ctx, user, url);
  if (!["GET", "HEAD"].includes(request.method)) return fail(405, "Method not allowed");
  if (url.pathname === "/" || url.pathname === "/index.html") return new Response(null, { status: 302, headers: { Location: HOME } });
  if (!atLeast(user.role, pageRole(url.pathname))) return forbiddenPage(user);
  return env.ASSETS.fetch(request);
}

export default {
  async fetch(request, env, ctx) {
    return withHeaders(await handle(request, env, ctx));
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runTick(env, event.scheduledTime));
  },
};
