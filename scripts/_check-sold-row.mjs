import axios from "axios";
import { getValidAccessToken } from "../server/gmailOrders.js";
import { getSheetSyncSettings } from "../server/sheetLedger.js";

const settings = getSheetSyncSettings();
const token = await getValidAccessToken();
const headers = { Authorization: `Bearer ${token}` };
const base = `https://sheets.googleapis.com/v4/spreadsheets/${settings.spreadsheetId}/values`;

const h = await axios.get(`${base}/${encodeURIComponent("'Sold 2026'!A1:W1")}`, { headers });
const r = await axios.get(`${base}/${encodeURIComponent("'Sold 2026'!A166:W166")}`, { headers });
const header = h.data.values?.[0] || [];
const row = r.data.values?.[0] || [];
const mapped = Object.fromEntries(header.map((name, i) => [name || `col${i}`, row[i] ?? ""]));
console.log(JSON.stringify(mapped, null, 2));

// Also search Inventory tabs for Yi / Hex / Proving Grounds
for (const tab of ["Inventory26", "Inventory25"]) {
  const res = await axios.get(`${base}/${encodeURIComponent(`'${tab}'!A:A`)}`, { headers });
  const vals = res.data.values || [];
  const hits = [];
  vals.forEach((row, idx) => {
    const t = String(row[0] || "");
    if (/yi|proving grounds|hex gauntlet|that all you got/i.test(t)) hits.push({ row: idx + 1, item: t });
  });
  console.log(tab, hits);
}
