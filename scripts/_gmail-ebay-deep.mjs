import axios from "axios";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "data", "gmail-sync-settings.json");
const API = "https://gmail.googleapis.com/gmail/v1/users/me";
const clientId = String(process.env.GMAIL_CLIENT_ID || "").trim();
const clientSecret = String(process.env.GMAIL_CLIENT_SECRET || "").trim();
const settings = JSON.parse(fs.readFileSync(DATA, "utf8"));
const oauth = settings.oauth || {};
let token = oauth.accessToken;
if (!token || Number(oauth.expiresAt || 0) < Date.now() + 30000) {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: oauth.refreshToken,
    grant_type: "refresh_token",
  });
  const tokRes = await axios.post("https://oauth2.googleapis.com/token", body.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  token = tokRes.data.access_token;
  oauth.accessToken = token;
  oauth.expiresAt = Date.now() + Number(tokRes.data.expires_in || 3600) * 1000;
  settings.oauth = oauth;
  fs.writeFileSync(DATA, JSON.stringify(settings, null, 2));
}

async function search(q, maxResults = 30) {
  const list = await axios.get(`${API}/messages`, {
    headers: { Authorization: `Bearer ${token}` },
    params: { q, maxResults },
  });
  const rows = [];
  for (const row of list.data.messages || []) {
    const msg = await axios.get(`${API}/messages/${encodeURIComponent(row.id)}`, {
      headers: { Authorization: `Bearer ${token}` },
      params: { format: "metadata", metadataHeaders: ["Subject", "From", "Date", "To"] },
    });
    const h = Object.fromEntries((msg.data.payload?.headers || []).map((x) => [String(x.name || "").toLowerCase(), x.value]));
    rows.push({ id: row.id, date: h.date, from: h.from, to: h.to, subject: h.subject, snippet: String(msg.data.snippet || "").slice(0, 200) });
  }
  return rows;
}

const queries = {
  ebaySender: "newer_than:60d (from:ebay.com OR from:ebayinc.com OR from:ebay)",
  madeSale: 'newer_than:60d "You made the sale"',
  itemSold: 'newer_than:60d "Your item sold"',
  ebayOrder: "newer_than:60d subject:(eBay) (sold OR sale OR order)",
  toSales: "newer_than:21d to:sales@preeminentstore.com (sold OR ebay OR tcgplayer)",
  allRecentSold: 'newer_than:7d (sold OR "payment received" OR "order total")',
};
const out = {};
for (const [k, q] of Object.entries(queries)) {
  out[k] = await search(q);
  console.log(`\n=== ${k}: ${out[k].length} ===`);
  for (const m of out[k].slice(0, 8)) console.log(`${m.date} | ${m.from} | ${m.subject}`);
}
fs.writeFileSync(path.join(ROOT, "data", "_gmail-ebay-deep.json"), JSON.stringify(out, null, 2));
