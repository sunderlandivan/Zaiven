import axios from "axios";
import { getValidAccessToken } from "./gmailOrders.js";

const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";

function quoteTab(title) {
  return `'${String(title).replace(/'/g, "''")}'`;
}

/** Sheets allows ~60 requests/min per user; space calls out so background runs never trip it. */
const MIN_GAP_MS = 1100;
let nextSlot = 0;

async function throttle() {
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + MIN_GAP_MS;
  if (wait) await new Promise((r) => setTimeout(r, wait));
}

async function authHeaders() {
  await throttle();
  const token = await getValidAccessToken();
  return { Authorization: `Bearer ${token}` };
}

function wrapError(error) {
  if (!error.response) return error;
  const msg = error.response?.data?.error?.message || error.message;
  const status = error.response?.status;
  if (status === 403 && /insufficient|scope/i.test(msg)) {
    return new Error("Google Sheets access not granted. Reconnect Google on the Sheet Sync page.");
  }
  if (status === 403) {
    return new Error(
      `Google Sheets denied access (${msg}). Make sure the sheet is shared with your connected Gmail as Editor and the Sheets API is enabled.`
    );
  }
  return new Error(`Google Sheets error: ${msg}`);
}

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

export async function getSpreadsheetMeta(spreadsheetId) {
  try {
    const res = await axios.get(`${SHEETS_API}/${spreadsheetId}`, {
      headers: await authHeaders(),
      params: { fields: "properties.title,sheets.properties(sheetId,title,gridProperties)" },
      timeout: 15000,
    });
    return res.data;
  } catch (e) {
    throw wrapError(e);
  }
}

export async function getSheetIdByTitle(spreadsheetId, title) {
  const meta = await getSpreadsheetMeta(spreadsheetId);
  const sheet = (meta.sheets || []).find((s) => s.properties?.title === title);
  if (!sheet) throw new Error(`Tab "${title}" not found in the Google Sheet.`);
  return { sheetId: sheet.properties.sheetId, rowCount: sheet.properties.gridProperties?.rowCount || 0 };
}

/** Returns 2D values. render: FORMATTED_VALUE | UNFORMATTED_VALUE | FORMULA */
export async function getValues(spreadsheetId, tab, a1 = "A1:Z", render = "UNFORMATTED_VALUE") {
  try {
    const res = await axios.get(
      `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(`${quoteTab(tab)}!${a1}`)}`,
      {
        headers: await authHeaders(),
        params: { valueRenderOption: render, dateTimeRenderOption: "FORMATTED_STRING" },
        timeout: 20000,
      }
    );
    return res.data.values || [];
  } catch (e) {
    throw wrapError(e);
  }
}

/** updates: [{ range: "A5", values: [[...]] }] with tab-relative A1 ranges. */
export async function batchUpdateValues(spreadsheetId, tab, updates) {
  if (!updates.length) return null;
  try {
    const res = await axios.post(
      `${SHEETS_API}/${spreadsheetId}/values:batchUpdate`,
      {
        valueInputOption: "USER_ENTERED",
        data: updates.map((u) => ({ range: `${quoteTab(tab)}!${u.range}`, values: u.values })),
      },
      { headers: await authHeaders(), timeout: 20000 }
    );
    return res.data;
  } catch (e) {
    throw wrapError(e);
  }
}

export async function batchUpdate(spreadsheetId, requests) {
  if (!requests.length) return null;
  try {
    const res = await axios.post(
      `${SHEETS_API}/${spreadsheetId}:batchUpdate`,
      { requests },
      { headers: await authHeaders(), timeout: 20000 }
    );
    return res.data;
  } catch (e) {
    throw wrapError(e);
  }
}
