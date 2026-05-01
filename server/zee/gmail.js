import fs from "fs";
import path from "path";
import crypto from "crypto";
import axios from "axios";

const DATA_DIR = path.resolve("data");
const ZEE_GMAIL_SETTINGS_PATH = path.join(DATA_DIR, "zee-gmail-settings.json");

const GMAIL_AUTH_BASE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GMAIL_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_API_BASE_URL = "https://gmail.googleapis.com/gmail/v1/users/me";
const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

function ensureDataFiles() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(ZEE_GMAIL_SETTINGS_PATH)) {
    fs.writeFileSync(
      ZEE_GMAIL_SETTINGS_PATH,
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
          },
        },
        null,
        2
      )
    );
  }
}

function readJson(filePath) {
  ensureDataFiles();
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  ensureDataFiles();
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

export function getZeeGmailTargetEmail() {
  return String(process.env.ZEE_GMAIL_TARGET_EMAIL || "iv3nsun@gmail.com").trim();
}

function getZeeGmailConfigFromEnv() {
  const clientId = String(process.env.GMAIL_CLIENT_ID || "").trim();
  const clientSecret = String(process.env.GMAIL_CLIENT_SECRET || "").trim();
  const port = String(process.env.PORT || "5173").trim();
  const redirectUri =
    String(process.env.ZEE_GMAIL_REDIRECT_URI || "").trim() ||
    `http://localhost:${port}/api/zee/gmail/auth/callback`;
  if (!clientId) throw new Error("Missing GMAIL_CLIENT_ID environment variable.");
  if (!clientSecret) throw new Error("Missing GMAIL_CLIENT_SECRET environment variable.");
  return { clientId, clientSecret, redirectUri };
}

function getSavedSettings() {
  return readJson(ZEE_GMAIL_SETTINGS_PATH);
}

function saveSettings(next) {
  writeJson(ZEE_GMAIL_SETTINGS_PATH, next);
}

async function exchangeCodeForTokens(code, redirectUri) {
  const cfg = getZeeGmailConfigFromEnv();
  const payload = new URLSearchParams();
  payload.set("code", code);
  payload.set("client_id", cfg.clientId);
  payload.set("client_secret", cfg.clientSecret);
  payload.set("redirect_uri", redirectUri);
  payload.set("grant_type", "authorization_code");
  const res = await axios.post(GMAIL_TOKEN_URL, payload.toString(), {
    timeout: 12000,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  return res.data || {};
}

async function refreshAccessToken(refreshToken) {
  const cfg = getZeeGmailConfigFromEnv();
  const payload = new URLSearchParams();
  payload.set("client_id", cfg.clientId);
  payload.set("client_secret", cfg.clientSecret);
  payload.set("refresh_token", refreshToken);
  payload.set("grant_type", "refresh_token");
  const res = await axios.post(GMAIL_TOKEN_URL, payload.toString(), {
    timeout: 12000,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  return res.data || {};
}

export async function getValidZeeGmailAccessToken() {
  const settings = getSavedSettings();
  const oauth = settings.oauth || {};
  const now = Date.now();
  const expiresAt = Number(oauth.expiresAt || 0);
  if (oauth.accessToken && expiresAt > now + 30000) return oauth.accessToken;
  if (!oauth.refreshToken) {
    throw new Error("Zee Gmail is not connected. Open Zee HUD and connect Gmail.");
  }
  const refreshed = await refreshAccessToken(oauth.refreshToken);
  settings.oauth = {
    ...oauth,
    accessToken: String(refreshed.access_token || ""),
    expiresAt: Date.now() + Number(refreshed.expires_in || 3600) * 1000,
    tokenType: String(refreshed.token_type || oauth.tokenType || "Bearer"),
    scope: String(refreshed.scope || oauth.scope || ""),
  };
  saveSettings(settings);
  return settings.oauth.accessToken;
}

export function getZeeGmailStatus() {
  const settings = getSavedSettings();
  const oauth = settings.oauth || {};
  return {
    connected: Boolean(oauth.refreshToken),
    targetEmail: getZeeGmailTargetEmail(),
    scope: oauth.scope || null,
    expiresAt: oauth.expiresAt || null,
  };
}

export function getZeeGmailAuthStartUrl() {
  const cfg = getZeeGmailConfigFromEnv();
  const state = crypto.randomBytes(24).toString("hex");
  const settings = getSavedSettings();
  settings.oauth = {
    ...(settings.oauth || {}),
    state,
    stateCreatedAt: new Date().toISOString(),
  };
  saveSettings(settings);
  const u = new URL(GMAIL_AUTH_BASE_URL);
  u.searchParams.set("client_id", cfg.clientId);
  u.searchParams.set("redirect_uri", cfg.redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", GMAIL_SCOPE);
  u.searchParams.set("access_type", "offline");
  u.searchParams.set("prompt", "consent");
  u.searchParams.set("state", state);
  return u.toString();
}

export async function handleZeeGmailAuthCallback({ code, state }) {
  const safeCode = String(code || "").trim();
  const safeState = String(state || "").trim();
  if (!safeCode) throw new Error("Missing OAuth code.");
  const settings = getSavedSettings();
  const expectedState = String(settings.oauth?.state || "").trim();
  if (!safeState || !expectedState || safeState !== expectedState) {
    throw new Error("OAuth state mismatch. Try connecting Zee Gmail again.");
  }
  const cfg = getZeeGmailConfigFromEnv();
  const token = await exchangeCodeForTokens(safeCode, cfg.redirectUri);
  if (!token.refresh_token && !settings.oauth?.refreshToken) {
    throw new Error("Gmail did not return a refresh token. Reconnect and approve consent again.");
  }
  settings.oauth = {
    ...(settings.oauth || {}),
    state: null,
    stateCreatedAt: null,
    accessToken: String(token.access_token || ""),
    refreshToken: String(token.refresh_token || settings.oauth?.refreshToken || ""),
    tokenType: String(token.token_type || "Bearer"),
    expiresAt: Date.now() + Number(token.expires_in || 3600) * 1000,
    scope: String(token.scope || GMAIL_SCOPE),
  };
  saveSettings(settings);
  return { connected: true };
}

export function disconnectZeeGmail() {
  const settings = getSavedSettings();
  settings.oauth = {
    state: null,
    stateCreatedAt: null,
    accessToken: null,
    refreshToken: null,
    tokenType: "Bearer",
    expiresAt: null,
    scope: null,
  };
  saveSettings(settings);
  return { disconnected: true };
}

function decodeB64Url(s) {
  if (!s) return "";
  const normalized = String(s).replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64").toString("utf8");
}

function htmlToText(html) {
  return String(html || "")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(p|div|tr|li|h1|h2|h3|h4|h5|h6)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function extractBodyFromPayload(payload) {
  if (!payload) return "";
  if (payload.body?.data) {
    const decoded = decodeB64Url(payload.body.data);
    const mime = String(payload.mimeType || "").toLowerCase();
    return mime.includes("text/html") ? htmlToText(decoded) : decoded;
  }
  const parts = Array.isArray(payload.parts) ? payload.parts : [];
  for (const part of parts) {
    const mime = String(part.mimeType || "").toLowerCase();
    if (mime.includes("text/plain") && part.body?.data) return decodeB64Url(part.body.data);
  }
  for (const part of parts) {
    const mime = String(part.mimeType || "").toLowerCase();
    if (mime.includes("text/html") && part.body?.data) return htmlToText(decodeB64Url(part.body.data));
  }
  for (const part of parts) {
    const nested = extractBodyFromPayload(part);
    if (nested) return nested;
  }
  return "";
}

function getHeader(headers, name) {
  const hit = (headers || []).find((h) => String(h.name || "").toLowerCase() === String(name).toLowerCase());
  return String(hit?.value || "").trim();
}

async function gmailListInbox(accessToken, maxResults) {
  const res = await axios.get(`${GMAIL_API_BASE_URL}/messages`, {
    timeout: 15000,
    headers: { Authorization: `Bearer ${accessToken}` },
    params: {
      maxResults,
      q: "in:inbox",
    },
  });
  return Array.isArray(res.data?.messages) ? res.data.messages : [];
}

async function gmailGetMessage(accessToken, messageId) {
  const res = await axios.get(`${GMAIL_API_BASE_URL}/messages/${encodeURIComponent(messageId)}`, {
    timeout: 15000,
    headers: { Authorization: `Bearer ${accessToken}` },
    params: { format: "full" },
  });
  return res.data || null;
}

/**
 * @param {{ max?: number }} opts
 */
export async function listZeeInboxSummaries({ max = 12 } = {}) {
  const accessToken = await getValidZeeGmailAccessToken();
  const list = await gmailListInbox(accessToken, Math.min(30, Math.max(1, max)));
  const out = [];
  for (const row of list) {
    const id = String(row.id || "");
    if (!id) continue;
    const msg = await gmailGetMessage(accessToken, id);
    if (!msg) continue;
    const headers = msg.payload?.headers || [];
    const subject = getHeader(headers, "Subject") || "(no subject)";
    const from = getHeader(headers, "From") || "";
    const date = getHeader(headers, "Date") || "";
    const snippet = String(msg.snippet || "").trim();
    const body = extractBodyFromPayload(msg.payload) || "";
    const preview = (body || snippet).slice(0, 4000);
    const threadId = String(msg.threadId || "");
    out.push({
      id,
      threadId,
      subject,
      from,
      date,
      snippet,
      preview,
      gmailUrl: `https://mail.google.com/mail/u/0/#inbox/${encodeURIComponent(threadId || id)}`,
    });
    if (out.length >= max) break;
  }
  return { targetEmail: getZeeGmailTargetEmail(), messages: out };
}
