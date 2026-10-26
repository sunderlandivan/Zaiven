const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";

/** The cloud portal may only ever read or write these tabs (Inventory25 / Sold 2025 are off limits). */
export const ALLOWED_TABS = new Set(["Inventory26", "Sold 2026"]);

export function assertAllowedTab(tab) {
  if (!ALLOWED_TABS.has(tab)) throw new Error(`Tab "${tab}" is not allowed in the cloud portal.`);
}

export const sheetWritesEnabled = (env) => env.SHEET_WRITES !== "off";

let cached = { token: "", exp: 0 };

/** Google limits Sheets to ~60 requests/min per user; spacing calls keeps cron runs well under it. */
const MIN_GAP_MS = 1100;
let nextSlot = 0;
async function throttle() {
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + MIN_GAP_MS;
  if (wait) await new Promise((r) => setTimeout(r, wait));
}

export class GoogleBudget {
  /** Workers Free allows 50 outbound fetches per invocation; stop well before that. */
  constructor(max = 40) {
    this.left = max;
  }
  take() {
    if (this.left <= 0) throw new Error("Google request budget for this run used up; the rest continues on the next run.");
    this.left -= 1;
  }
}

export async function accessToken(env, budget) {
  if (cached.token && cached.exp > Date.now() + 60_000) return cached.token;
  if (!env.GOOGLE_REFRESH_TOKEN || !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new Error("Google is not connected in the cloud portal (GOOGLE_REFRESH_TOKEN / client secrets missing).");
  }
  budget?.take();
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: env.GOOGLE_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (j.error === "invalid_grant") throw new Error("Google login expired. Reconnect Google on the PC portal, then update GOOGLE_REFRESH_TOKEN.");
    throw new Error(`Google token refresh failed (${r.status}).`);
  }
  cached = { token: j.access_token, exp: Date.now() + Number(j.expires_in || 3600) * 1000 };
  return cached.token;
}

async function call(env, budget, url, init = {}) {
  await throttle();
  const token = await accessToken(env, budget);
  budget?.take();
  const r = await fetch(url, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = j?.error?.message || `HTTP ${r.status}`;
    if (r.status === 403) throw new Error(`Google Sheets denied access (${msg}).`);
    throw new Error(`Google Sheets error: ${msg}`);
  }
  return j;
}

const quoteTab = (t) => `'${String(t).replace(/'/g, "''")}'`;

export function columnLetter(index) {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export async function getValues(env, budget, spreadsheetId, tab, a1 = "A1:AZ", render = "UNFORMATTED_VALUE") {
  assertAllowedTab(tab);
  const u = new URL(`${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(`${quoteTab(tab)}!${a1}`)}`);
  u.searchParams.set("valueRenderOption", render);
  u.searchParams.set("dateTimeRenderOption", "FORMATTED_STRING");
  return (await call(env, budget, u.toString())).values || [];
}

export async function getSheetIdByTitle(env, budget, spreadsheetId, title) {
  assertAllowedTab(title);
  const u = `${SHEETS_API}/${spreadsheetId}?fields=${encodeURIComponent("sheets.properties(sheetId,title)")}`;
  const meta = await call(env, budget, u);
  const sheet = (meta.sheets || []).find((s) => s.properties?.title === title);
  if (!sheet) throw new Error(`Tab "${title}" not found in the Google Sheet.`);
  return sheet.properties.sheetId;
}

export async function batchUpdateValues(env, budget, spreadsheetId, tab, updates) {
  assertAllowedTab(tab);
  if (!sheetWritesEnabled(env)) throw new Error("Sheet writes are off in this environment.");
  if (!updates.length) return null;
  return call(env, budget, `${SHEETS_API}/${spreadsheetId}/values:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({ valueInputOption: "USER_ENTERED", data: updates.map((u) => ({ range: `${quoteTab(tab)}!${u.range}`, values: u.values })) }),
  });
}

/** Structural edits (row inserts) on one tab; sheetId must come from getSheetIdByTitle for an allowed tab. */
export async function batchUpdateTab(env, budget, spreadsheetId, tab, requests) {
  assertAllowedTab(tab);
  if (!sheetWritesEnabled(env)) throw new Error("Sheet writes are off in this environment.");
  if (!requests.length) return null;
  return call(env, budget, `${SHEETS_API}/${spreadsheetId}:batchUpdate`, { method: "POST", body: JSON.stringify({ requests }) });
}
