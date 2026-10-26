import axios from "axios";
import { getValidAccessToken } from "../server/gmailOrders.js";
import { getSheetSyncSettings, readTab } from "../server/sheetLedger.js";

const settings = getSheetSyncSettings();
const token = await getValidAccessToken();
const headers = { Authorization: `Bearer ${token}` };
const base = `https://sheets.googleapis.com/v4/spreadsheets/${settings.spreadsheetId}/values`;
const h = await axios.get(`${base}/${encodeURIComponent("'Sold 2026'!A1:Z1")}`, { headers });
const r = await axios.get(`${base}/${encodeURIComponent("'Sold 2026'!A166:Z166")}`, { headers });
const header = h.data.values?.[0] || [];
const row = r.data.values?.[0] || [];
console.log("HEADER", header.map((x, i) => `${i}:${x}`).join(" | "));
console.log("ROW166", row.map((x, i) => `${i}:${x}`).join(" | "));

const inv = await readTab("Inventory25");
const pg = inv.rows.filter((x) => /proving grounds|yi/i.test(x.itemId || ""));
console.log("PG rows", JSON.stringify(pg.map((x) => ({ row: x.rowNumber, item: x.itemId, qty: x.qty, cost: x.cost })), null, 2));
