import fs from "fs";
import path from "path";
import crypto from "crypto";
import axios from "axios";

import {
  applyAutoStampHeuristicsToAllOrders,
  applyDefaultTcgFeesToAllOrders,
  isLikelyStampShippingCost,
} from "./inventoryAgent.js";

const DATA_DIR = path.resolve("data");
const ORDERS_DB_PATH = path.join(DATA_DIR, "orders-db.json");
const GMAIL_SYNC_SETTINGS_PATH = path.join(DATA_DIR, "gmail-sync-settings.json");

const GMAIL_AUTH_BASE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GMAIL_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_API_BASE_URL = "https://gmail.googleapis.com/gmail/v1/users/me";
const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

const TCGPLAYER_QUERY =
  'from:(@tcgplayer.com) subject:("TCGplayer" OR "order" OR "tracking")';
const TCGPLAYER_TRACKING_QUERY =
  'from:(@tcgplayer.com) subject:("Tracking Added to TCGplayer Order")';
/** Broaden subjects: USPS renames / ® vs (R); label emails may omit “Payment”. */
const USPS_QUERY =
  "from:(auto-reply@usps.com OR ecns@usps.com OR noreply@usps.com OR noreply-ecns@usps.com OR email@usps.com) " +
  "(subject:(Click-N-Ship OR \"Click N Ship\" OR ClickNShip OR \"label receipt\" OR \"payment confirmation\" OR \"shipment confirmation\" OR \"shipping label\"))";

/** Gmail `after:` accepts YYYY/MM/DD. Empty env = no floor (whole mailbox). */
function getGmailSyncEarliestAfterDate() {
  const raw = String(process.env.GMAIL_SYNC_AFTER ?? "2026/01/01").trim();
  if (!raw) return "";
  return raw.replace(/-/g, "/");
}

/** Extra `q` tokens: YTD floor + optional incremental cursor (Gmail ANDs `after:` clauses). */
function buildGmailSyncQuerySuffix({ lastSyncAt, fullRescan }) {
  const parts = [];
  const earliest = getGmailSyncEarliestAfterDate();
  if (earliest) parts.push(`after:${earliest}`);
  if (!fullRescan && lastSyncAt) {
    const epochSeconds = Math.floor(new Date(lastSyncAt).getTime() / 1000);
    if (Number.isFinite(epochSeconds) && epochSeconds > 0) {
      parts.push(`after:${epochSeconds}`);
    }
  }
  return parts.length ? ` ${parts.join(" ")}` : "";
}

function ensureDataFiles() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(ORDERS_DB_PATH)) {
    fs.writeFileSync(ORDERS_DB_PATH, JSON.stringify({ orders: [] }, null, 2));
  }
  if (!fs.existsSync(GMAIL_SYNC_SETTINGS_PATH)) {
    fs.writeFileSync(
      GMAIL_SYNC_SETTINGS_PATH,
      JSON.stringify(
        {
          oauth: {
            state: null,
            stateCreatedAt: null,
            accessToken: null,
            refreshToken: null,
            tokenType: "Bearer",
            expiresAt: null,
            scope: null,
          },
          sync: {
            lastSyncAt: null,
            lastHistoryId: null,
            summary: null,
          },
        },
        null,
        2
      )
    );
  }
}

function readJson(filePath) {
  ensureDataFiles();
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  ensureDataFiles();
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function parseOrderDateForStorage(v) {
  const t = String(v || "").trim();
  if (!t) return new Date().toISOString().slice(0, 10);
  const parsed = new Date(t);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return new Date().toISOString().slice(0, 10);
}

function parseCurrency(v) {
  const match = String(v || "").match(/([0-9]+(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)/);
  if (!match) return 0;
  const n = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** Same calendar month+day in UTC (ignores year) — helps CSV year typos vs USPS “Placed on”. */
function calendarMdEqualIgnoringYear(a, b) {
  if (!a || !b || Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return false;
  return a.getUTCMonth() === b.getUTCMonth() && a.getUTCDate() === b.getUTCDate();
}

function decodeB64Url(s) {
  if (!s) return "";
  const normalized = String(s).replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64").toString("utf8");
}

function htmlToText(html) {
  return String(html || "")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(p|div|tr|li|h1|h2|h3|h4|h5|h6)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function extractBodyFromPayload(payload) {
  if (!payload) return "";
  if (payload.body?.data) {
    const decoded = decodeB64Url(payload.body.data);
    const mime = String(payload.mimeType || "").toLowerCase();
    return mime.includes("text/html") ? htmlToText(decoded) : decoded;
  }
  const parts = Array.isArray(payload.parts) ? payload.parts : [];
  for (const part of parts) {
    const mime = String(part.mimeType || "").toLowerCase();
    if (mime.includes("text/plain") && part.body?.data) return decodeB64Url(part.body.data);
  }
  for (const part of parts) {
    const mime = String(part.mimeType || "").toLowerCase();
    if (mime.includes("text/html") && part.body?.data) return htmlToText(decodeB64Url(part.body.data));
  }
  for (const part of parts) {
    const nested = extractBodyFromPayload(part);
    if (nested) return nested;
  }
  return "";
}

function getHeader(headers, name) {
  const hit = (headers || []).find((h) => String(h.name || "").toLowerCase() === String(name).toLowerCase());
  return String(hit?.value || "").trim();
}

function normalizeOrderNumber(value) {
  const t = String(value || "").trim();
  if (!t) return "";
  const m = t.match(/[A-Z0-9-]{8,}/i);
  return m ? m[0].toUpperCase() : "";
}

function isLikelyTcgplayerOrderNumber(value) {
  const t = normalizeOrderNumber(value);
  if (!t) return false;
  const chunks = t.split("-").filter(Boolean);
  if (chunks.length !== 3) return false;
  return chunks.every((c) => /^[A-Z0-9]{4,12}$/.test(c));
}

function extractTracking(value) {
  const raw = String(value || "");
  const compact = raw.replace(/\s+/g, "");
  const haystacks = [compact, raw];
  const matches = [];
  for (const t of haystacks) {
    const m = t.match(/\b([0-9]{20,40}|[A-Z]{2}[0-9]{9}[A-Z]{2})\b/gi) || [];
    matches.push(...m);
  }
  if (!matches.length) return "";
  const normalized = matches.map((x) => String(x).toUpperCase().replace(/\s+/g, ""));
  normalized.sort((a, b) => b.length - a.length);
  return normalized[0];
}

function extractRecipientBlock(text) {
  const raw = String(text || "").replace(/\r\n?/g, "\n");
  const shipHead = /(?:shipped to|ship(?:ped)? to|shipping to|deliver(?:y)? to)\s*:?\s*/i;
  const looseName = raw.match(
    /shipped to\s*:?\s*([A-Za-z][A-Za-z\s'.-]{1,48}?)(?=\s*,|\s*\d{3,}|\s*$|\n|<)/i
  );
  if (looseName) {
    const namePart = String(looseName[1] || "")
      .replace(/\$\s*[0-9]+(?:\.[0-9]{1,2})?$/g, "")
      .trim();
    if (namePart.length >= 2) {
      const tail = raw.slice(raw.indexOf(looseName[0]) + looseName[0].length).split(/\n/)[0] || "";
      const addrPart = tail.replace(/^\s*,\s*/, "").trim() || null;
      return { recipientName: namePart, recipientAddress: addrPart };
    }
  }

  const inline = raw.match(new RegExp(`${shipHead.source}([^\\n]+)`, "i"));
  if (inline) {
    let chunk = String(inline[1] || "").trim();
    chunk = chunk.replace(/\$\s*[0-9]+(?:\.[0-9]{1,2})?$/g, "").trim();
    const commaIdx = chunk.indexOf(",");
    const namePart = (commaIdx >= 0 ? chunk.slice(0, commaIdx) : chunk.split(/\s{2,}|\t+/)[0] || chunk).trim();
    const addrPart = commaIdx >= 0 ? chunk.slice(commaIdx + 1).trim() : "";
    if (namePart.length >= 2) {
      return {
        recipientName: namePart,
        recipientAddress: addrPart || null,
      };
    }
  }

  const lines = raw
    .split(/\n/)
    .map((x) => x.trim())
    .filter(Boolean);
  const shippedIdx = lines.findIndex((x) => shipHead.test(x));
  if (shippedIdx < 0) return null;

  const shippedLine = lines[shippedIdx] || "";
  const inlineName = shippedLine.replace(shipHead, "").trim();
  const inlineNameClean = inlineName.replace(/\$\s*[0-9]+(?:\.[0-9]{1,2})?$/g, "").trim();
  const hasInlineName = Boolean(inlineNameClean);
  const fallbackNameIdx = shippedIdx + 1;
  const nameLineIdx = hasInlineName ? shippedIdx : fallbackNameIdx;
  if (!hasInlineName && fallbackNameIdx >= lines.length) return null;
  const name = (hasInlineName ? inlineNameClean : String(lines[fallbackNameIdx] || "").trim()) || null;

  const addressLines = [];
  for (let i = nameLineIdx + 1; i < Math.min(lines.length, nameLineIdx + 6); i++) {
    const line = lines[i];
    if (/^(subtotal|shipping|tax|order summary|scheduled delivery date)/i.test(line)) break;
    if (/^\$\s*[0-9]+(?:\.[0-9]{1,2})?$/i.test(line)) continue;
    addressLines.push(line);
  }
  return {
    recipientName: name,
    recipientAddress: addressLines.length ? addressLines.join(", ") : null,
  };
}

function parseTcgplayerEmail(message) {
  const headers = message.payload?.headers || [];
  const subject = getHeader(headers, "Subject");
  const from = getHeader(headers, "From");
  const headerDate = getHeader(headers, "Date");
  const body = extractBodyFromPayload(message.payload) || "";
  const bodyText = `${subject}\n${body}`;
  const lc = bodyText.toLowerCase();
  const sellerSignals = [
    "ready to ship",
    "shipped - in transit",
    "completed - paid",
    "you have sold",
    "order details",
  ];
  const buyerSignals = [
    "your order has been processed",
    "payment for this order has been received",
  ];
  const hasSellerSignal = sellerSignals.some((s) => lc.includes(s));
  const hasBuyerSignal = buyerSignals.some((s) => lc.includes(s));
  const fromLooksTcg = /tcgplayer\.com/i.test(from);

  const orderNumber =
    normalizeOrderNumber((bodyText.match(/order\s*[:#]\s*([A-Z0-9-]{8,})/i) || [])[1]) ||
    normalizeOrderNumber((subject.match(/order[^A-Z0-9]*([A-Z0-9-]{8,})/i) || [])[1]);
  if (!orderNumber) return null;
  if (!fromLooksTcg) return null;
  if (hasBuyerSignal && !hasSellerSignal) return null;
  if (!hasSellerSignal) return null;

  const totalText = (bodyText.match(/order\s*total\s*[:\s]\$?\s*([0-9,]+(?:\.[0-9]{1,2})?)/i) || [])[1];
  const orderAmount = parseCurrency(totalText);
  const taxMatch =
    bodyText.match(/(?:^|[\n\r])\s*(?:sales\s+)?tax\s*[:]\s*\$?\s*([0-9,]+(?:\.[0-9]{1,2})?)/im) ||
    bodyText.match(/\btax\s+amount\s*[:]\s*\$?\s*([0-9,]+(?:\.[0-9]{1,2})?)/im);
  const buyerTax = taxMatch ? parseCurrency(taxMatch[1]) : 0;

  return {
    type: "tcg_order",
    orderNumber,
    orderAmount,
    salePrice: orderAmount,
    ...(buyerTax > 0 ? { buyerTax } : {}),
    purchaseDate: parseOrderDateForStorage(headerDate),
    isSellerContext: true,
    sourceMessageId: String(message.id || ""),
    sourceInternalDate: String(message.internalDate || ""),
  };
}

function parseTcgplayerTrackingUpdateEmail(message) {
  const headers = message.payload?.headers || [];
  const subject = getHeader(headers, "Subject");
  const from = getHeader(headers, "From");
  const headerDate = getHeader(headers, "Date");
  const body = extractBodyFromPayload(message.payload) || "";
  const bodyText = `${subject}\n${body}`;
  const fromLooksTcg = /tcgplayer\.com/i.test(from);
  if (!fromLooksTcg) return null;
  const lc = bodyText.toLowerCase();
  const trackingSignal =
    lc.includes("tracking added to tcgplayer order") ||
    lc.includes("tracking number for order") ||
    lc.includes("tracking # for order");
  if (!trackingSignal) return null;

  const orderNumber =
    normalizeOrderNumber((subject.match(/order[^A-Z0-9]*([A-Z0-9-]{8,})/i) || [])[1]) ||
    normalizeOrderNumber((bodyText.match(/order[^A-Z0-9]*([A-Z0-9-]{8,})/i) || [])[1]);
  if (!orderNumber || !isLikelyTcgplayerOrderNumber(orderNumber)) return null;

  const trackingNumber = extractTracking(bodyText);
  if (!trackingNumber) return null;

  return {
    type: "tcg_tracking_update",
    orderNumber,
    trackingNumber,
    purchaseDate: parseOrderDateForStorage(headerDate),
    isSellerContext: false,
    sourceMessageId: String(message.id || ""),
    sourceInternalDate: String(message.internalDate || ""),
  };
}

function parseUspsEmail(message) {
  const headers = message.payload?.headers || [];
  const subject = getHeader(headers, "Subject");
  const headerDate = getHeader(headers, "Date");
  const body = extractBodyFromPayload(message.payload) || "";
  const bodyText = `${subject}\n${body}`;
  const orderNumber =
    normalizeOrderNumber((bodyText.match(/order\s*#?\s*[:]\s*([A-Z0-9-]{8,})/i) || [])[1]) ||
    normalizeOrderNumber((bodyText.match(/order\s*#\s*([A-Z0-9-]{8,})/i) || [])[1]);

  const tracking = extractTracking(bodyText);
  const recipient = extractRecipientBlock(bodyText);
  if (!tracking) return null;
  const subtotalMatch =
    bodyText.match(/total amount\s*:\s*\$?\s*([0-9]+(?:\.[0-9]{1,2})?)/i) ||
    bodyText.match(/subtotal\s*:\s*\$?\s*([0-9]+(?:\.[0-9]{1,2})?)/i) ||
    bodyText.match(/postage(?:\s+&\s+fees)?\s*:\s*\$?\s*([0-9]+(?:\.[0-9]{1,2})?)/i);
  const labelCost = subtotalMatch ? Number(subtotalMatch[1]) : 0;

  const placedMatch = bodyText.match(/placed on\s*:?\s*([^\n]+)/i);
  const purchaseDate = parseOrderDateForStorage(placedMatch ? placedMatch[1] : headerDate);

  return {
    type: "usps_label",
    orderNumber: isLikelyTcgplayerOrderNumber(orderNumber) ? orderNumber : "",
    trackingNumber: tracking || "",
    purchaseDate,
    labelCost: Number.isFinite(labelCost) ? labelCost : 0,
    recipientName: recipient?.recipientName || null,
    recipientAddress: recipient?.recipientAddress || null,
    sourceMessageId: String(message.id || ""),
    sourceInternalDate: String(message.internalDate || ""),
  };
}

function normalizePersonName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b[a-z]\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function nameTokens(value) {
  return normalizePersonName(value)
    .split(" ")
    .filter((t) => t && t.length >= 2);
}

function nameSimilarity(a, b) {
  const at = nameTokens(a);
  const bt = nameTokens(b);
  if (!at.length || !bt.length) return 0;
  const aSet = new Set(at);
  const bSet = new Set(bt);
  let common = 0;
  for (const token of aSet) {
    if (bSet.has(token)) common += 1;
  }
  const denom = Math.max(aSet.size, bSet.size, 1);
  return common / denom;
}

function getGmailConfigFromEnv() {
  const clientId = String(process.env.GMAIL_CLIENT_ID || "").trim();
  const clientSecret = String(process.env.GMAIL_CLIENT_SECRET || "").trim();
  const redirectUri =
    String(process.env.GMAIL_REDIRECT_URI || "").trim() ||
    "http://localhost:5173/api/orders/gmail/auth/callback";
  if (!clientId) throw new Error("Missing GMAIL_CLIENT_ID environment variable.");
  if (!clientSecret) throw new Error("Missing GMAIL_CLIENT_SECRET environment variable.");
  return { clientId, clientSecret, redirectUri };
}

function getSavedSettings() {
  return readJson(GMAIL_SYNC_SETTINGS_PATH);
}

function saveSettings(next) {
  writeJson(GMAIL_SYNC_SETTINGS_PATH, next);
}

async function exchangeCodeForTokens(code) {
  const cfg = getGmailConfigFromEnv();
  const payload = new URLSearchParams();
  payload.set("code", code);
  payload.set("client_id", cfg.clientId);
  payload.set("client_secret", cfg.clientSecret);
  payload.set("redirect_uri", cfg.redirectUri);
  payload.set("grant_type", "authorization_code");
  const res = await axios.post(GMAIL_TOKEN_URL, payload.toString(), {
    timeout: 12000,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  return res.data || {};
}

async function refreshAccessToken(refreshToken) {
  const cfg = getGmailConfigFromEnv();
  const payload = new URLSearchParams();
  payload.set("client_id", cfg.clientId);
  payload.set("client_secret", cfg.clientSecret);
  payload.set("refresh_token", refreshToken);
  payload.set("grant_type", "refresh_token");
  const res = await axios.post(GMAIL_TOKEN_URL, payload.toString(), {
    timeout: 12000,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  return res.data || {};
}

async function getValidAccessToken() {
  const settings = getSavedSettings();
  const oauth = settings.oauth || {};
  const now = Date.now();
  const expiresAt = Number(oauth.expiresAt || 0);
  if (oauth.accessToken && expiresAt > now + 30000) return oauth.accessToken;
  if (!oauth.refreshToken) {
    throw new Error("Gmail is not connected. Click Connect Gmail first.");
  }
  const refreshed = await refreshAccessToken(oauth.refreshToken);
  settings.oauth = {
    ...oauth,
    accessToken: String(refreshed.access_token || ""),
    expiresAt: Date.now() + Number(refreshed.expires_in || 3600) * 1000,
    tokenType: String(refreshed.token_type || oauth.tokenType || "Bearer"),
    scope: String(refreshed.scope || oauth.scope || ""),
  };
  saveSettings(settings);
  return settings.oauth.accessToken;
}

async function gmailListMessages(accessToken, query, maxResults = 25, pageToken = null) {
  const res = await axios.get(`${GMAIL_API_BASE_URL}/messages`, {
    timeout: 15000,
    headers: { Authorization: `Bearer ${accessToken}` },
    params: {
      q: query,
      maxResults,
      pageToken: pageToken || undefined,
    },
  });
  return {
    messages: Array.isArray(res.data?.messages) ? res.data.messages : [],
    nextPageToken: String(res.data?.nextPageToken || ""),
  };
}

async function gmailCollectMessages(accessToken, query, { maxResults = 100, maxPages = 5 } = {}) {
  const out = [];
  let token = "";
  const pages = Math.max(1, Math.min(20, Number(maxPages || 5)));
  for (let p = 0; p < pages; p++) {
    const page = await gmailListMessages(accessToken, query, maxResults, token || null);
    out.push(...(Array.isArray(page.messages) ? page.messages : []));
    token = String(page.nextPageToken || "");
    if (!token) break;
  }
  return out;
}

async function gmailGetMessage(accessToken, messageId) {
  const res = await axios.get(`${GMAIL_API_BASE_URL}/messages/${encodeURIComponent(messageId)}`, {
    timeout: 15000,
    headers: { Authorization: `Bearer ${accessToken}` },
    params: { format: "full" },
  });
  return res.data || null;
}

function upsertParsedOrdersIntoDb(records, { dryRun = false } = {}) {
  const db = readJson(ORDERS_DB_PATH);
  const existingOrders = Array.isArray(db.orders) ? db.orders : [];
  const byOrder = new Map();
  for (const o of existingOrders) {
    const key = normalizeOrderNumber(o.orderNumber);
    if (key) byOrder.set(key, o);
  }

  let inserted = 0;
  let updated = 0;
  const uspsMatchDebug = [];
  for (const rec of records) {
    const key = normalizeOrderNumber(rec.orderNumber);
    if (!key) {
      if (rec.type === "usps_label" && rec.trackingNumber) {
        const recName = normalizePersonName(rec.recipientName);
        const recDate = new Date(String(rec.purchaseDate || ""));
        let best = null;
        let bestScore = 0;
        let strongCandidateCount = 0;
        const topCandidates = [];
        for (const o of existingOrders) {
          if (String(o.trackingNumber || "").trim()) continue;
          if (o.noTrackingNeeded || isLikelyStampShippingCost(o.shippingCost)) continue;
          const buyer = normalizePersonName(o.buyerName || "");
          let score = 0;
          let sim = 0;
          if (recName && buyer) {
            if (buyer === recName) score += 3;
            if (buyer.includes(recName) || recName.includes(buyer)) score += 1.2;
            sim = nameSimilarity(buyer, recName);
            score += sim * 2;
          }

          const oDate = new Date(String(o.purchaseDate || ""));
          let dayDiff = Number.POSITIVE_INFINITY;
          if (!Number.isNaN(recDate.getTime()) && !Number.isNaN(oDate.getTime())) {
            dayDiff = Math.abs(recDate.getTime() - oDate.getTime()) / (1000 * 60 * 60 * 24);
            if (dayDiff <= 7) score += 0.9;
            else if (dayDiff <= 30) score += 0.4;
          }

          if (
            recName &&
            buyer &&
            buyer === recName &&
            Number(rec.labelCost || 0) > 0 &&
            Number(o.shippingCost || 0) > 0 &&
            calendarMdEqualIgnoringYear(recDate, oDate)
          ) {
            const sd = Math.abs(Number(rec.labelCost || 0) - Number(o.shippingCost || 0));
            if (sd <= 2) score += 1.15;
          }

          const labelCost = Number(rec.labelCost || 0);
          const shipCost = Number(o.shippingCost || 0);
          let shipDiff = Number.POSITIVE_INFINITY;
          if (labelCost > 0 && shipCost > 0) {
            shipDiff = Math.abs(labelCost - shipCost);
            if (shipDiff <= 0.5) score += 1.1;
            else if (shipDiff <= 2) score += 0.6;
          }

          // TCG order date in CSV can disagree with USPS label date (typo / export quirk) while name + postage match.
          if (
            recName &&
            buyer &&
            buyer === recName &&
            labelCost > 0 &&
            shipCost > 0 &&
            shipDiff <= 1.5 &&
            Number.isFinite(dayDiff) &&
            dayDiff > 45
          ) {
            score += 0.85;
          }

          // Fallback signal when recipient name cannot be reliably parsed from USPS HTML.
          if (!recName && shipDiff <= 0.6 && dayDiff <= 3) score += 1.0;
          if (/shipped|completed/i.test(String(o.status || ""))) score += 0.2;
          if (score >= 1.65) strongCandidateCount += 1;
          topCandidates.push({
            orderNumber: o.orderNumber || "",
            buyerName: o.buyerName || "",
            shippingCost: Number(o.shippingCost || 0),
            score: Number(score.toFixed(3)),
          });
          if (score > bestScore) {
            bestScore = score;
            best = o;
          }
        }
        topCandidates.sort((a, b) => b.score - a.score);
        const secondScore = topCandidates.length > 1 ? Number(topCandidates[1].score || 0) : 0;
        const scoreGap = Number(bestScore) - secondScore;
        const acceptMatch =
          Boolean(best) &&
          bestScore >= 1.65 &&
          (strongCandidateCount <= 3 ||
            (bestScore >= 2.35 && scoreGap >= 0.3 && strongCandidateCount <= 12));
        uspsMatchDebug.push({
          recipientName: rec.recipientName || "",
          trackingNumber: rec.trackingNumber || "",
          purchaseDate: rec.purchaseDate || "",
          labelCost: Number(rec.labelCost || 0),
          bestScore: Number(bestScore.toFixed(3)),
          secondScore: Number(secondScore.toFixed(3)),
          scoreGap: Number(scoreGap.toFixed(3)),
          strongCandidateCount,
          selectedOrderNumber: best && acceptMatch ? best.orderNumber || "" : "",
          selectedBuyerName: best && acceptMatch ? best.buyerName || "" : "",
          topCandidates: topCandidates.slice(0, 3),
        });
        if (acceptMatch) {
          best.trackingNumber = rec.trackingNumber;
          best.lastEmailSyncAt = new Date().toISOString();
          updated += 1;
        }
      }
      continue;
    }
    const current = byOrder.get(key);
    // Gmail sync is enrichment-only: do not create brand-new rows from email parsing.
    if (!current) continue;
    const base = current;
    const stampLike = Boolean(base.noTrackingNeeded) || isLikelyStampShippingCost(base.shippingCost);
    const merged = {
      ...base,
      orderNumber: key,
      salePrice: rec.salePrice > 0 ? rec.salePrice : Number(base.salePrice || 0),
      orderAmount: rec.orderAmount > 0 ? rec.orderAmount : Number(base.orderAmount || 0),
      buyerTax:
        rec.buyerTax > 0 ? rec.buyerTax : Number(base.buyerTax || 0) > 0 ? Number(base.buyerTax) : base.buyerTax,
      trackingNumber: stampLike ? "" : rec.trackingNumber || base.trackingNumber || "",
      purchaseDate: rec.purchaseDate || base.purchaseDate,
      recipientName: rec.recipientName || base.recipientName || null,
      recipientAddress: rec.recipientAddress || base.recipientAddress || null,
      lastEmailSyncAt: new Date().toISOString(),
    };
    if (current) {
      updated += 1;
      Object.assign(current, merged);
    }
  }
  db.orders = existingOrders;
  let stampHeuristicUpdated = 0;
  if (!dryRun) {
    writeJson(ORDERS_DB_PATH, db);
    stampHeuristicUpdated = Number(applyAutoStampHeuristicsToAllOrders().updated || 0);
    applyDefaultTcgFeesToAllOrders();
  }
  return {
    inserted,
    updated: updated + stampHeuristicUpdated,
    totalOrders: db.orders.length,
    uspsMatchDebug,
    stampHeuristicUpdated,
  };
}

export function getGmailSyncStatus() {
  const settings = getSavedSettings();
  const oauth = settings.oauth || {};
  const sync = settings.sync || {};
  return {
    connected: Boolean(oauth.refreshToken),
    scope: oauth.scope || null,
    expiresAt: oauth.expiresAt || null,
    lastSyncAt: sync.lastSyncAt || null,
    lastSyncSummary: sync.summary || null,
    earliestAfter: getGmailSyncEarliestAfterDate() || null,
  };
}

export function getGmailAuthStartUrl() {
  const cfg = getGmailConfigFromEnv();
  const state = crypto.randomBytes(24).toString("hex");
  const settings = getSavedSettings();
  settings.oauth = {
    ...(settings.oauth || {}),
    state,
    stateCreatedAt: new Date().toISOString(),
  };
  saveSettings(settings);
  const u = new URL(GMAIL_AUTH_BASE_URL);
  u.searchParams.set("client_id", cfg.clientId);
  u.searchParams.set("redirect_uri", cfg.redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", GMAIL_SCOPE);
  u.searchParams.set("access_type", "offline");
  u.searchParams.set("prompt", "consent");
  u.searchParams.set("state", state);
  return u.toString();
}

export async function handleGmailAuthCallback({ code, state }) {
  const safeCode = String(code || "").trim();
  const safeState = String(state || "").trim();
  if (!safeCode) throw new Error("Missing OAuth code.");
  const settings = getSavedSettings();
  const expectedState = String(settings.oauth?.state || "").trim();
  if (!safeState || !expectedState || safeState !== expectedState) {
    throw new Error("OAuth state mismatch. Please try connecting Gmail again.");
  }
  const token = await exchangeCodeForTokens(safeCode);
  if (!token.refresh_token && !settings.oauth?.refreshToken) {
    throw new Error("Gmail did not return a refresh token. Reconnect and approve consent again.");
  }
  settings.oauth = {
    ...(settings.oauth || {}),
    state: null,
    stateCreatedAt: null,
    accessToken: String(token.access_token || ""),
    refreshToken: String(token.refresh_token || settings.oauth?.refreshToken || ""),
    tokenType: String(token.token_type || "Bearer"),
    expiresAt: Date.now() + Number(token.expires_in || 3600) * 1000,
    scope: String(token.scope || GMAIL_SCOPE),
  };
  saveSettings(settings);
  return { connected: true };
}

export function disconnectGmailSync() {
  const settings = getSavedSettings();
  settings.oauth = {
    state: null,
    stateCreatedAt: null,
    accessToken: null,
    refreshToken: null,
    tokenType: "Bearer",
    expiresAt: null,
    scope: null,
  };
  saveSettings(settings);
  return { disconnected: true };
}

export async function syncOrdersFromGmail({ maxPerQuery = 50, maxPages = 5, dryRun = false, fullRescan = false } = {}) {
  const accessToken = await getValidAccessToken();
  const settings = getSavedSettings();
  const lastSyncAt = fullRescan ? null : settings.sync?.lastSyncAt || null;
  const suffix = buildGmailSyncQuerySuffix({ lastSyncAt, fullRescan: Boolean(fullRescan) });
  const perQuery = Math.max(1, Math.min(100, Number(maxPerQuery || 50)));

  const [tcgList, tcgTrackingList, uspsList] = await Promise.all([
    gmailCollectMessages(accessToken, `${TCGPLAYER_QUERY}${suffix}`, { maxResults: perQuery, maxPages }),
    gmailCollectMessages(accessToken, `${TCGPLAYER_TRACKING_QUERY}${suffix}`, { maxResults: perQuery, maxPages }),
    gmailCollectMessages(accessToken, `${USPS_QUERY}${suffix}`, { maxResults: perQuery, maxPages }),
  ]);
  const allIds = Array.from(
    new Set([...tcgList, ...tcgTrackingList, ...uspsList].map((m) => m.id).filter(Boolean))
  );
  const messages = [];
  for (const id of allIds) {
    const msg = await gmailGetMessage(accessToken, id);
    if (msg) messages.push(msg);
  }

  const parsedRecords = [];
  let skipped = 0;
  const parsedByType = {};
  for (const msg of messages) {
    const headers = msg.payload?.headers || [];
    const subject = getHeader(headers, "Subject");
    const from = getHeader(headers, "From");
    let parsed = null;
    // USPS sends many subject variants; trust From + body parser, not only “click-n-ship”.
    if (/@usps\.com/i.test(from)) {
      parsed = parseUspsEmail(msg);
    }
    if (!parsed) {
      parsed = parseTcgplayerTrackingUpdateEmail(msg) || parseTcgplayerEmail(msg);
    }
    if (!parsed) {
      skipped += 1;
      continue;
    }
    parsedRecords.push(parsed);
    parsedByType[parsed.type] = Number(parsedByType[parsed.type] || 0) + 1;
  }

  const collapsed = new Map();
  const uspsNoKeyRecords = [];
  for (const rec of parsedRecords) {
    const key = normalizeOrderNumber(rec.orderNumber);
    if (!key) {
      if (rec.type === "usps_label") {
        uspsNoKeyRecords.push(rec);
      }
      continue;
    }
    const existing = collapsed.get(key);
    collapsed.set(key, {
      ...(existing || {}),
      ...rec,
      orderNumber: key,
      hasTcgOrderData:
        Boolean(existing?.hasTcgOrderData) ||
        (rec.type === "tcg_order" && rec.isSellerContext === true),
      hasUspsLabelData: Boolean(existing?.hasUspsLabelData) || rec.type === "usps_label",
    });
  }
  const mergedRecords = [...Array.from(collapsed.values()), ...uspsNoKeyRecords];

  const dbResult = upsertParsedOrdersIntoDb(mergedRecords, { dryRun: Boolean(dryRun) });
  const summary = {
    at: new Date().toISOString(),
    earliestAfter: getGmailSyncEarliestAfterDate() || null,
    gmailQuerySuffix: suffix.trim() || null,
    scannedMessages: messages.length,
    parsedRecords: parsedRecords.length,
    parsedByType,
    mergedRecords: mergedRecords.length,
    skippedMessages: skipped,
    inserted: dbResult.inserted,
    updated: dbResult.updated,
    totalOrders: dbResult.totalOrders,
    uspsMatchDebug: Array.isArray(dbResult.uspsMatchDebug) ? dbResult.uspsMatchDebug.slice(0, 30) : [],
    fullRescan: Boolean(fullRescan),
    dryRun: Boolean(dryRun),
  };
  if (!dryRun) {
    settings.sync = {
      ...(settings.sync || {}),
      lastSyncAt: summary.at,
      summary,
    };
    saveSettings(settings);
  }
  return summary;
}
