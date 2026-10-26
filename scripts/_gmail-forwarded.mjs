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
}
async function search(q, maxResults = 20) {
  const list = await axios.get(`${API}/messages`, {
    headers: { Authorization: `Bearer ${token}` },
    params: { q, maxResults },
  });
  const rows = [];
  for (const row of list.data.messages || []) {
    const msg = await axios.get(`${API}/messages/${encodeURIComponent(row.id)}`, {
      headers: { Authorization: `Bearer ${token}` },
      params: { format: "metadata", metadataHeaders: ["Subject", "From", "Date", "To", "Delivered-To"] },
    });
    const h = Object.fromEntries((msg.data.payload?.headers || []).map((x) => [String(x.name || "").toLowerCase(), x.value]));
    rows.push({ date: h.date, from: h.from, to: h.to, subject: h.subject, snippet: String(msg.data.snippet || "").slice(0, 180) });
  }
  return rows;
}
const qs = {
  live: "newer_than:21d (to:theivan@live.com OR from:theivan@live.com) (ebay OR sold)",
  ebayAnywhere: "newer_than:45d (ebayinc OR \"ebay message\" OR \"sold on ebay\" OR \"Congratulations\")",
  paypalReceived: 'newer_than:21d from:paypal.com ("You\'ve received" OR "Money received" OR "payment from")',
};
for (const [k, q] of Object.entries(qs)) {
  const rows = await search(q);
  console.log(`\n=== ${k} (${rows.length}) ===`);
  for (const m of rows) console.log(JSON.stringify(m));
}
