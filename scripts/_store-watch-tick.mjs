/**
 * One 15m store-watch tick: health + live Merchant feed + critical Gmail glance.
 * Uses orders Gmail OAuth (Zee Gmail refresh currently invalid_grant).
 * Prints JSON summary only (no tokens/secrets).
 */
import axios from "axios";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "data", "gmail-sync-settings.json");
const API = "https://gmail.googleapis.com/gmail/v1/users/me";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

const out = { at: new Date().toISOString(), health: null, feed: null, gmail: null, errors: [] };

try {
  const h = await axios.get("http://localhost:5173/health", { timeout: 8000 });
  out.health = { ok: Boolean(h.data?.ok), body: h.data };
} catch (e) {
  out.health = { ok: false, error: e.message };
  out.errors.push("health");
}

try {
  const feed = await axios.get("https://preeminentstore.com/feed.xml", { timeout: 30000, responseType: "text" });
  const xml = String(feed.data || "");
  const items = (xml.match(/<g:id>/g) || []).length;
  const deckHits = (xml.match(/custom\s*deck|Custom Built Deck/gi) || []).length;
  out.feed = { status: feed.status, items, customDeckMentions: deckHits, bytes: xml.length };
  if (deckHits > 0) out.errors.push("feed-has-decks");
} catch (e) {
  out.feed = { ok: false, error: e.message };
  out.errors.push("feed");
}

try {
  const clientId = String(process.env.GMAIL_CLIENT_ID || "").trim();
  const clientSecret = String(process.env.GMAIL_CLIENT_SECRET || "").trim();
  if (!clientId || !clientSecret) throw new Error("GMAIL_* env missing");
  const settings = JSON.parse(fs.readFileSync(DATA, "utf8"));
  const oauth = settings.oauth || {};
  if (!oauth.refreshToken) throw new Error("orders Gmail not connected");
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

  async function search(q, maxResults = 8) {
    const list = await axios.get(`${API}/messages`, {
      headers: { Authorization: `Bearer ${token}` },
      params: { q, maxResults },
      timeout: 20000,
    });
    const rows = [];
    for (const row of list.data.messages || []) {
      const msg = await axios.get(`${API}/messages/${encodeURIComponent(row.id)}`, {
        headers: { Authorization: `Bearer ${token}` },
        params: { format: "metadata", metadataHeaders: ["Subject", "From", "Date"] },
        timeout: 15000,
      });
      const h = Object.fromEntries((msg.data.payload?.headers || []).map((x) => [String(x.name || "").toLowerCase(), x.value]));
      rows.push({
        date: h.date || "",
        from: h.from || "",
        subject: h.subject || "(no subject)",
        snippet: String(msg.data.snippet || "").slice(0, 200),
      });
    }
    return rows;
  }

  out.gmail = {
    via: "orders-oauth",
    merchant: await search('newer_than:2d ("merchant center" OR counterfeit OR "google shopping" OR "Your Merchant Center")'),
    critical: await search("newer_than:1d (suspend OR suspended OR \"payment failed\" OR \"bank declined\" OR violation OR \"listing with photos\" OR removed)"),
  };
} catch (e) {
  out.gmail = { ok: false, error: e.response?.data?.error || e.message };
  out.errors.push("gmail");
}

console.log(JSON.stringify(out, null, 2));
process.exit(out.errors.length ? 1 : 0);
