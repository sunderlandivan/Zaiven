/**
 * One-shot Gmail scan for Merchant Center + recent sales + removals.
 * Prints JSON summary; writes full bodies to data/_gmail-owner-scan.json.
 */
import axios from "axios";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "data", "gmail-sync-settings.json");
const OUT = path.join(ROOT, "data", "_gmail-owner-scan.json");
const API = "https://gmail.googleapis.com/gmail/v1/users/me";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

const clientId = String(process.env.GMAIL_CLIENT_ID || "").trim();
const clientSecret = String(process.env.GMAIL_CLIENT_SECRET || "").trim();
if (!clientId || !clientSecret) {
  console.error("Missing GMAIL_* env");
  process.exit(1);
}

const settings = JSON.parse(fs.readFileSync(DATA, "utf8"));
const oauth = settings.oauth || {};
if (!oauth.refreshToken) {
  console.error("orders Gmail not connected");
  process.exit(1);
}

let token = oauth.accessToken;
if (!token || Number(oauth.expiresAt || 0) < Date.now() + 30000) {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: oauth.refreshToken,
    grant_type: "refresh_token",
  });
  const tokRes = await axios.post(TOKEN_URL, body.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    timeout: 12000,
  });
  token = tokRes.data.access_token;
  oauth.accessToken = token;
  oauth.expiresAt = Date.now() + Number(tokRes.data.expires_in || 3600) * 1000;
  settings.oauth = oauth;
  fs.writeFileSync(DATA, JSON.stringify(settings, null, 2));
}

function walk(p, parts = []) {
  if (!p) return parts;
  if (p.body?.data) {
    parts.push(Buffer.from(p.body.data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
  }
  for (const c of p.parts || []) walk(c, parts);
  return parts;
}

async function search(q, maxResults = 15) {
  const list = await axios.get(`${API}/messages`, {
    headers: { Authorization: `Bearer ${token}` },
    params: { q, maxResults },
    timeout: 20000,
  });
  const rows = [];
  for (const row of list.data.messages || []) {
    const msg = await axios.get(`${API}/messages/${encodeURIComponent(row.id)}`, {
      headers: { Authorization: `Bearer ${token}` },
      params: { format: "full" },
      timeout: 20000,
    });
    const h = Object.fromEntries((msg.data.payload?.headers || []).map((x) => [String(x.name || "").toLowerCase(), x.value]));
    const bodies = walk(msg.data.payload);
    const text = bodies
      .join("\n")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 4000);
    rows.push({
      id: row.id,
      date: h.date || "",
      from: h.from || "",
      subject: h.subject || "(no subject)",
      snippet: String(msg.data.snippet || "").slice(0, 300),
      text,
    });
  }
  return rows;
}

const queries = {
  merchant: 'newer_than:21d ("merchant center" OR counterfeit OR "google shopping" OR "Request Review" OR misrepresentation OR "Shopping ads" OR merchants.google.com)',
  ebaySold: 'newer_than:14d (from:ebay.com OR from:ebay) (sold OR "You sold" OR "payment received" OR Congratulations OR "Order details")',
  tcgSold: 'newer_than:14d (from:tcgplayer.com) (sold OR "order confirmation" OR "You sold" OR "New Order" OR invoice OR "Order #" OR "has sold" OR "buyer purchased")',
  tcgRemoved: 'newer_than:21d (from:tcgplayer.com) (removed OR "Inventory Update" OR Yi OR Riftbound)',
  paypalSold: 'newer_than:10d (from:paypal.com) (You\'ve received OR "Payment received" OR "money from")',
  recentInbox: "newer_than:5d in:inbox -category:promotions -category:social",
};

const out = {};
for (const [k, q] of Object.entries(queries)) {
  out[k] = await search(q, k === "recentInbox" ? 30 : 15);
}
fs.writeFileSync(OUT, JSON.stringify(out, null, 2));

const brief = {};
for (const [k, rows] of Object.entries(out)) {
  brief[k] = rows.map((m) => ({
    date: m.date,
    subject: m.subject,
    from: (m.from || "").slice(0, 70),
    snippet: (m.snippet || "").slice(0, 220),
    textPreview: (m.text || "").slice(0, 350),
  }));
}
console.log(JSON.stringify(brief, null, 2));
