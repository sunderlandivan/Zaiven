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
      .slice(0, 2500);
    rows.push({
      id: row.id,
      date: h.date,
      from: h.from,
      subject: h.subject,
      snippet: String(msg.data.snippet || "").slice(0, 250),
      text,
    });
  }
  return rows;
}

const out = {
  fromEbay: await search("newer_than:21d from:ebay.com", 25),
  ebayKeyword: await search("newer_than:14d ebay (sold OR buyer OR payment OR Congrats OR won)", 25),
  soldAny: await search('newer_than:10d ("have sold" OR "You sold" OR "Congratulations" OR "Order details")', 25),
  pirateship: await search("newer_than:10d (from:pirateship.com OR from:ebay) (label OR shipped OR sold)", 15),
};
fs.writeFileSync(path.join(ROOT, "data", "_gmail-ebay-scan.json"), JSON.stringify(out, null, 2));
const brief = {};
for (const [k, rows] of Object.entries(out)) {
  brief[k] = rows.map((m) => ({ date: m.date, subject: m.subject, from: (m.from || "").slice(0, 60), snippet: m.snippet, text: m.text.slice(0, 400) }));
}
console.log(JSON.stringify(brief, null, 2));
