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

function walk(p, parts = []) {
  if (!p) return parts;
  if (p.body?.data) parts.push(Buffer.from(p.body.data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
  for (const c of p.parts || []) walk(c, parts);
  return parts;
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
      params: { format: "full" },
    });
    const h = Object.fromEntries((msg.data.payload?.headers || []).map((x) => [String(x.name || "").toLowerCase(), x.value]));
    const text = walk(msg.data.payload)
      .join("\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 3500);
    rows.push({ id: row.id, date: h.date, from: h.from, subject: h.subject, snippet: String(msg.data.snippet || "").slice(0, 300), text });
  }
  return rows;
}

const queries = {
  ebaySale: 'newer_than:30d from:ebay.com subject:("You made the sale" OR "item sold" OR "Your item sold" OR "sold")',
  ebayAny: "newer_than:30d from:ebay.com",
  ebayNotify: 'newer_than:21d ("ebay" OR ebayinc) (sold OR sale OR "order #" OR buyer)',
  tcgAllSold: 'newer_than:21d from:tcgplayer.com subject:("have sold")',
};
const out = {};
for (const [k, q] of Object.entries(queries)) out[k] = await search(q, 20);
fs.writeFileSync(path.join(ROOT, "data", "_gmail-ebay-sales.json"), JSON.stringify(out, null, 2));
for (const [k, rows] of Object.entries(out)) {
  console.log(`\n=== ${k} (${rows.length}) ===`);
  for (const m of rows) {
    console.log(JSON.stringify({ date: m.date, subject: m.subject, from: (m.from || "").slice(0, 50), snippet: m.snippet, text: m.text.slice(0, 500) }, null, 2));
  }
}
