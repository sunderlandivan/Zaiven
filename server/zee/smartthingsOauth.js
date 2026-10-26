/**
 * SmartThings OAuth (long-lived) for Zee HUD.
 *
 * - Authorize URL: https://api.smartthings.com/oauth/authorize
 * - Token URL:     https://auth-global.api.smartthings.com/oauth/token
 *
 * Notes:
 * - Access tokens expire 24h; refresh tokens are returned and rotate on each use.
 * - SmartThings docs ask for HTTPS redirect URIs for production marketplace apps,
 *   but personal OAuth-In SmartApps registered via the CLI accept other URIs too.
 *
 * Required env vars (set after running `smartthings apps:create`):
 *   ZEE_SMARTTHINGS_CLIENT_ID
 *   ZEE_SMARTTHINGS_CLIENT_SECRET
 *   ZEE_SMARTTHINGS_REDIRECT_URI (must match exactly what was registered)
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import axios from "axios";

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "data");
const TOKEN_PATH = path.join(DATA_DIR, "zee-smartthings-oauth.json");

const AUTH_URL = "https://api.smartthings.com/oauth/authorize";
const TOKEN_URL = "https://auth-global.api.smartthings.com/oauth/token";
const DEFAULT_SCOPES = ["r:devices:*", "x:devices:*", "r:locations:*"];

function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(TOKEN_PATH)) {
    fs.writeFileSync(
      TOKEN_PATH,
      JSON.stringify(
        {
          oauth: {
            state: null,
            stateCreatedAt: null,
            accessToken: null,
            refreshToken: null,
            tokenType: "Bearer",
            expiresAt: null,
            scope: null,
            installedAppId: null,
            connectedAt: null,
          },
        },
        null,
        2
      )
    );
  }
}

function readState() {
  ensureFile();
  return JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8"));
}

function writeState(value) {
  ensureFile();
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(value, null, 2));
}

function getClientCreds() {
  const clientId = String(process.env.ZEE_SMARTTHINGS_CLIENT_ID || "").trim();
  const clientSecret = String(process.env.ZEE_SMARTTHINGS_CLIENT_SECRET || "").trim();
  return { clientId, clientSecret };
}

export function getRedirectUri() {
  const explicit = String(process.env.ZEE_SMARTTHINGS_REDIRECT_URI || "").trim();
  if (explicit) return explicit;
  const port = String(process.env.PORT || "5173").trim();
  return `http://localhost:${port}/api/zee/smart-home/oauth/callback`;
}

export function isOauthConfigured() {
  const { clientId, clientSecret } = getClientCreds();
  return Boolean(clientId && clientSecret);
}

export function isOauthConnected() {
  if (!isOauthConfigured()) return false;
  const s = readState().oauth || {};
  return Boolean(s.refreshToken);
}

function basicAuthHeader() {
  const { clientId, clientSecret } = getClientCreds();
  const enc = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  return `Basic ${enc}`;
}

function persistTokens(prevOauth, payload) {
  const next = {
    ...prevOauth,
    state: null,
    stateCreatedAt: null,
    accessToken: String(payload.access_token || ""),
    refreshToken: String(payload.refresh_token || prevOauth?.refreshToken || ""),
    tokenType: String(payload.token_type || "Bearer"),
    expiresAt: Date.now() + Number(payload.expires_in || 86400) * 1000,
    scope: String(payload.scope || prevOauth?.scope || ""),
    installedAppId: String(payload.installed_app_id || prevOauth?.installedAppId || ""),
    connectedAt: prevOauth?.connectedAt || new Date().toISOString(),
  };
  const settings = readState();
  settings.oauth = next;
  writeState(settings);
  return next;
}

async function exchangeCodeForTokens(code) {
  const redirect_uri = getRedirectUri();
  const body = new URLSearchParams();
  body.set("grant_type", "authorization_code");
  body.set("code", code);
  body.set("redirect_uri", redirect_uri);
  body.set("client_id", getClientCreds().clientId);
  const res = await axios.post(TOKEN_URL, body.toString(), {
    timeout: 15_000,
    headers: {
      Authorization: basicAuthHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    validateStatus: () => true,
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(
      `SmartThings token exchange failed (${res.status}): ${typeof res.data === "string" ? res.data : JSON.stringify(res.data)}`
    );
  }
  return res.data || {};
}

async function refreshAccessToken(refreshToken) {
  const body = new URLSearchParams();
  body.set("grant_type", "refresh_token");
  body.set("refresh_token", refreshToken);
  body.set("client_id", getClientCreds().clientId);
  const res = await axios.post(TOKEN_URL, body.toString(), {
    timeout: 15_000,
    headers: {
      Authorization: basicAuthHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    validateStatus: () => true,
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(
      `SmartThings token refresh failed (${res.status}): ${typeof res.data === "string" ? res.data : JSON.stringify(res.data)}`
    );
  }
  return res.data || {};
}

/**
 * Returns a valid OAuth access token, refreshing if needed.
 * Returns null if OAuth isn't configured or hasn't been connected yet.
 * Throws if refresh fails (forcing the caller to fall back to the PAT).
 */
export async function getOauthAccessToken() {
  if (!isOauthConfigured()) return null;
  const settings = readState();
  const oauth = settings.oauth || {};
  if (!oauth.refreshToken) return null;
  const now = Date.now();
  const expiresAt = Number(oauth.expiresAt || 0);
  if (oauth.accessToken && expiresAt > now + 60_000) return oauth.accessToken;
  const refreshed = await refreshAccessToken(oauth.refreshToken);
  const next = persistTokens(oauth, refreshed);
  return next.accessToken;
}

export function getOauthAuthorizeUrl() {
  if (!isOauthConfigured()) {
    throw new Error("Set ZEE_SMARTTHINGS_CLIENT_ID and ZEE_SMARTTHINGS_CLIENT_SECRET first.");
  }
  const state = crypto.randomBytes(24).toString("hex");
  const settings = readState();
  settings.oauth = {
    ...(settings.oauth || {}),
    state,
    stateCreatedAt: new Date().toISOString(),
  };
  writeState(settings);
  const u = new URL(AUTH_URL);
  u.searchParams.set("client_id", getClientCreds().clientId);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", DEFAULT_SCOPES.join(" "));
  u.searchParams.set("redirect_uri", getRedirectUri());
  u.searchParams.set("state", state);
  return u.toString();
}

export async function handleOauthCallback({ code, state }) {
  const safeCode = String(code || "").trim();
  const safeState = String(state || "").trim();
  if (!safeCode) throw new Error("Missing OAuth code.");
  const settings = readState();
  const expectedState = String(settings.oauth?.state || "").trim();
  if (!safeState || !expectedState || safeState !== expectedState) {
    throw new Error("OAuth state mismatch. Reconnect and try again.");
  }
  const tokens = await exchangeCodeForTokens(safeCode);
  if (!tokens.access_token || !tokens.refresh_token) {
    throw new Error(
      `SmartThings did not return both access and refresh tokens. Response: ${JSON.stringify(tokens).slice(0, 240)}`
    );
  }
  persistTokens(settings.oauth || {}, tokens);
  return { connected: true };
}

export function disconnectOauth() {
  const settings = readState();
  settings.oauth = {
    state: null,
    stateCreatedAt: null,
    accessToken: null,
    refreshToken: null,
    tokenType: "Bearer",
    expiresAt: null,
    scope: null,
    installedAppId: null,
    connectedAt: null,
  };
  writeState(settings);
  return { disconnected: true };
}

export function getOauthStatus() {
  const oauth = readState().oauth || {};
  return {
    configured: isOauthConfigured(),
    connected: Boolean(oauth.refreshToken),
    redirectUri: getRedirectUri(),
    scope: oauth.scope || null,
    expiresAt: oauth.expiresAt || null,
    connectedAt: oauth.connectedAt || null,
  };
}
