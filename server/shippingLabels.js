import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";

import {
  extractBodyFromPayload,
  getHeader,
  getValidAccessToken,
  gmailCollectMessages,
  gmailGetMessage,
} from "./gmailOrders.js";
import { classifyShipmentKind } from "./shipmentKind.js";
import { coreTrackingNumber } from "./inventoryAgent.js";

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
const ORDERS_DB_PATH = path.join(DATA_DIR, "orders-db.json");
const LABELS_PATH = path.join(DATA_DIR, "shipping-labels.json");
const BACKUP_DIR = path.join(DATA_DIR, "backups");

/** USPS Click-N-Ship is the only label service found in the owner's mailbox. */
const CLICK_N_SHIP_QUERY =
  'from:(noreply-ecns@usps.com OR auto-reply@usps.com) subject:("Click-N-Ship" "Payment Confirmation")';

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_DAYS_AFTER_ORDER = 0;
const MAX_DAYS_AFTER_ORDER = 10;
const AUTO_APPLY_MIN_SCORE = 4;
const SUGGEST_MIN_SCORE = 1;

function readJsonSafe(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function readLabelStore() {
  const s = readJsonSafe(LABELS_PATH, {});
  return {
    seenMessageIds: Array.isArray(s.seenMessageIds) ? s.seenMessageIds : [],
    labels: Array.isArray(s.labels) ? s.labels : [],
    lastScanAt: s.lastScanAt || null,
    lastBackfillAt: s.lastBackfillAt || null,
    lastMatchSummary: s.lastMatchSummary || null,
  };
}

export function backupOrdersDb(tag = "backup") {
  if (!fs.existsSync(ORDERS_DB_PATH)) return null;
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const dest = path.join(BACKUP_DIR, `orders-db-${stamp}-${tag}.json`);
  fs.copyFileSync(ORDERS_DB_PATH, dest);
  return dest;
}

function normTracking(v) {
  return String(v || "").replace(/\s+/g, "").toUpperCase();
}

function normName(v) {
  return String(v || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b[a-z]\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function nameMatch(a, b) {
  const x = normName(a);
  const y = normName(b);
  if (!x || !y) return { level: "none", sim: 0 };
  if (x === y) return { level: "exact", sim: 1 };
  const xs = new Set(x.split(" "));
  const ys = new Set(y.split(" "));
  let common = 0;
  for (const t of xs) if (ys.has(t)) common += 1;
  const sim = common / Math.max(xs.size, ys.size, 1);
  if (sim >= 0.5) return { level: "partial", sim };
  return { level: "conflict", sim };
}

const NAME_RANK = { none: 0, conflict: 1, partial: 2, exact: 3 };

/** Best match against the ship-to name and the buyer name (gift orders ship to someone else). */
function orderNameMatch(labelName, order) {
  let best = { level: "none", sim: 0 };
  for (const n of [order.shipToName, order.buyerName || order.recipientName]) {
    const m = nameMatch(labelName, n);
    if (NAME_RANK[m.level] > NAME_RANK[best.level] || (m.level === best.level && m.sim > best.sim)) best = m;
  }
  return best;
}

function zipOf(text) {
  const m = String(text || "").match(/\b(\d{5})(?:-\d{4})?\b/);
  return m ? m[1] : "";
}

function parseUspsDate(text) {
  const m = String(text || "").match(/([A-Za-z]{3,9})\s+(\d{1,2}),\s*(\d{4})/);
  if (!m) return "";
  const d = new Date(`${m[1]} ${m[2]}, ${m[3]} 12:00:00 UTC`);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

const TRACKING_LINE_RE = /^(\d{20,34}|[A-Z]{2}\d{9}[A-Z]{2})$/;
const CITY_LINE_RE = /^(.+?)\s+([A-Z]{2})\s+(\d{5})(?:-\d{4})?(?:\s+US)?$/;
const MONEY_LINE_RE = /^\$\s*([0-9,]+\.\d{2})$/;

/** One Click-N-Ship payment email can hold several labels. Street lines are not kept. */
export function parseClickNShipEmail(message) {
  const headers = message?.payload?.headers || [];
  const subject = getHeader(headers, "Subject");
  if (!/click-?n-?ship/i.test(subject) || !/payment confirmation/i.test(subject)) return [];
  const body = extractBodyFromPayload(message.payload) || "";
  const lines = body
    .replace(/&reg;|®/g, "")
    .split(/\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const valueAfter = (labelRe) => {
    const i = lines.findIndex((l) => labelRe.test(l));
    return i >= 0 ? lines[i + 1] || "" : "";
  };
  const labelDate =
    parseUspsDate(valueAfter(/^placed on:?$/i)) ||
    new Date(Number(message.internalDate || Date.now())).toISOString().slice(0, 10);
  const uspsOrderId = valueAfter(/^order #:?$/i);

  const labels = [];
  for (let i = 0; i < lines.length; i++) {
    const tracking = normTracking(lines[i]);
    if (!TRACKING_LINE_RE.test(tracking)) continue;
    const service = i > 0 && !/^\$/.test(lines[i - 1]) ? lines[i - 1] : "";
    const shipIdx = lines.findIndex((l, j) => j > i && j <= i + 4 && /^shipped to:?$/i.test(l));
    let recipientName = "";
    let city = "";
    let state = "";
    let zip = "";
    let end = i + 1;
    if (shipIdx > 0) {
      recipientName = lines[shipIdx + 1] || "";
      for (let j = shipIdx + 2; j < Math.min(lines.length, shipIdx + 8); j++) {
        const m = lines[j].match(CITY_LINE_RE);
        if (m) {
          city = m[1];
          state = m[2];
          zip = m[3];
          end = j + 1;
          break;
        }
      }
    }
    let cost = 0;
    for (let j = end; j < Math.min(lines.length, end + 6); j++) {
      const m = lines[j].match(MONEY_LINE_RE);
      if (m) {
        cost = Number(m[1].replace(/,/g, ""));
        break;
      }
      if (TRACKING_LINE_RE.test(normTracking(lines[j]))) break;
    }
    labels.push({
      tracking,
      carrier: "USPS",
      service,
      recipientName,
      city,
      state,
      zip,
      labelDate,
      cost,
      uspsOrderId,
      sourceMessageId: String(message.id || ""),
    });
  }
  return labels;
}

function gmailAfterFloor() {
  const raw = String(process.env.GMAIL_SYNC_AFTER ?? "2026/01/01").trim();
  return raw ? raw.replace(/-/g, "/") : "";
}

/** Fetch unseen Click-N-Ship emails and add their labels to the store. */
export async function scanLabelEmails({ full = false, accessToken = null } = {}) {
  const token = accessToken || (await getValidAccessToken());
  const store = readLabelStore();
  const parts = [CLICK_N_SHIP_QUERY];
  const floor = gmailAfterFloor();
  if (floor) parts.push(`after:${floor}`);
  if (!full && store.lastScanAt) {
    const since = Math.floor((new Date(store.lastScanAt).getTime() - 3 * DAY_MS) / 1000);
    if (since > 0) parts.push(`after:${since}`);
  }
  const list = await gmailCollectMessages(token, parts.join(" "), { maxResults: 100, maxPages: full ? 10 : 3 });
  const seen = new Set(store.seenMessageIds);
  const known = new Set(store.labels.map((l) => l.tracking));
  let newMessages = 0;
  let newLabels = 0;
  for (const m of list) {
    if (!m?.id || seen.has(m.id)) continue;
    const msg = await gmailGetMessage(token, m.id);
    seen.add(m.id);
    newMessages += 1;
    for (const label of parseClickNShipEmail(msg)) {
      if (known.has(label.tracking)) continue;
      known.add(label.tracking);
      store.labels.push({ ...label, status: "unmatched", orderNumber: null, confidence: 0, candidates: [] });
      newLabels += 1;
    }
  }
  store.seenMessageIds = [...seen];
  store.lastScanAt = new Date().toISOString();
  if (full) store.lastBackfillAt = store.lastScanAt;
  writeJson(LABELS_PATH, store);
  return { listed: list.length, newMessages, newLabels, totalLabels: store.labels.length };
}

function dayDiff(labelDate, orderDate) {
  const a = new Date(`${labelDate}T12:00:00Z`).getTime();
  const b = new Date(`${String(orderDate || "").slice(0, 10)}T12:00:00Z`).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.NaN;
  return Math.round((a - b) / DAY_MS);
}

function isManualNoTracking(order) {
  return Boolean(order.noTrackingNeeded) && !order.stampAuto;
}

function scoreCandidate(label, order) {
  if (String(order.trackingNumber || "").trim()) return null;
  if (isManualNoTracking(order)) return null;
  if (/cancel|refund/i.test(String(order.status || ""))) return null;
  const days = dayDiff(label.labelDate, order.purchaseDate);
  if (!Number.isFinite(days) || days < MIN_DAYS_AFTER_ORDER || days > MAX_DAYS_AFTER_ORDER) return null;

  const { kind } = classifyShipmentKind(order);
  const name = orderNameMatch(label.recipientName, order);
  if (name.level === "conflict") return null;
  const orderZip = zipOf(order.shipToZip || order.recipientAddress);
  const zipLevel = orderZip && label.zip ? (orderZip === label.zip ? "match" : "conflict") : "none";
  if (zipLevel === "conflict") return null;
  // Singles ship in envelopes: auto only on name + ZIP + date; exact name + date (no ZIP on file) is suggest-only.
  if (kind === "singles" && name.level !== "exact") return null;
  const suggestOnly = kind === "singles" && zipLevel !== "match";

  const reasons = [];
  if (kind === "singles") reasons.push("singles order");
  let score = 0;
  if (name.level === "exact") {
    score += 3;
    reasons.push("name");
  } else if (name.level === "partial") {
    score += 1.5 + name.sim;
    reasons.push("partial name");
  } else {
    reasons.push("no buyer name on order");
  }
  if (zipLevel === "match") {
    score += 2;
    reasons.push("ZIP");
  }
  if (days <= 3) score += 1;
  else if (days <= 6) score += 0.5;
  else score += 0.2;
  reasons.push(`${days}d after order`);
  if (kind === "sealed") {
    score += 0.5;
    reasons.push("sealed");
  }
  if (Number(order.shippingCost || 0) >= 4) score += 0.3;
  return {
    orderNumber: String(order.orderNumber || ""),
    score: Number(score.toFixed(2)),
    nameLevel: name.level,
    zipLevel,
    days,
    kind,
    suggestOnly,
    reasons,
  };
}

function applyLabelToOrder(order, label, source) {
  order.trackingNumber = label.tracking;
  order.carrier = label.carrier || "USPS";
  order.trackingSource = source;
  order.labelCost = Number(label.cost || 0);
  if (!Number(order.shippingCost || 0) && Number(label.cost || 0) > 0) order.shippingCost = Number(label.cost);
  if (label.zip && !order.shipToZip) order.shipToZip = label.zip;
  if (!String(order.buyerName || "").trim() && label.recipientName) order.buyerName = label.recipientName;
  // Keep the stamp heuristic from clearing a label-backed tracking number.
  order.noTrackingNeeded = false;
  order.stampAuto = false;
  order.labelMatchedAt = new Date().toISOString();
  order.updatedAt = order.labelMatchedAt;
}

/**
 * Re-score open labels against orders. Auto-applies only exact-name, unique, in-window matches;
 * everything else with plausible candidates becomes a suggestion for the owner.
 */
export function matchLabelsToOrders({ dryRun = false } = {}) {
  const store = readLabelStore();
  const db = readJsonSafe(ORDERS_DB_PATH, { orders: [] });
  const orders = Array.isArray(db.orders) ? db.orders : [];
  const byTracking = new Map();
  for (const o of orders) {
    const t = coreTrackingNumber(o.trackingNumber);
    if (t) byTracking.set(t, o);
  }

  const byTcgTracking = new Map();
  for (const o of orders) {
    for (const t of Array.isArray(o.tcgTrackingNumbers) ? o.tcgTrackingNumbers : []) byTcgTracking.set(coreTrackingNumber(t), o);
  }

  const open = [];
  for (const label of store.labels) {
    const core = coreTrackingNumber(label.tracking);
    const owner = byTracking.get(core);
    const tcgOwner = owner ? null : byTcgTracking.get(core);
    if (tcgOwner && label.status !== "dismissed") {
      // TCGplayer lists this label on an order that holds a different number locally; owner must pick.
      label.status = "conflict";
      label.orderNumber = tcgOwner.orderNumber || null;
      label.candidates = [];
      continue;
    }
    if (label.status === "conflict") {
      label.status = "unmatched";
      label.orderNumber = null;
    }
    if (owner) {
      if (!["auto", "confirmed"].includes(label.status)) {
        label.status = "preexisting";
        label.orderNumber = owner.orderNumber || null;
        label.candidates = [];
      }
      continue;
    }
    if (["auto", "confirmed"].includes(label.status)) {
      // Owner removed or replaced the tracking on that order; reconsider.
      label.status = "unmatched";
      label.orderNumber = null;
    }
    if (label.status === "dismissed") continue;
    const candidates = orders
      .map((o) => scoreCandidate(label, o))
      .filter(Boolean)
      .sort((a, b) => b.score - a.score);
    open.push({ label, candidates });
  }

  // An order exact-named by two labels (split shipment, repeat buyer) is never auto-applied.
  const exactHits = new Map();
  for (const { candidates } of open) {
    for (const c of candidates) {
      if (c.nameLevel === "exact") exactHits.set(c.orderNumber, (exactHits.get(c.orderNumber) || 0) + 1);
    }
  }

  const ordersByNumber = new Map(orders.map((o) => [String(o.orderNumber || ""), o]));
  const claimed = new Set();
  let autoApplied = 0;
  for (const entry of open) {
    const { label, candidates } = entry;
    const named = candidates.filter((c) => c.nameLevel !== "none");
    const best = candidates[0];
    const unique =
      best &&
      best.nameLevel === "exact" &&
      !best.suggestOnly &&
      named.length === 1 &&
      exactHits.get(best.orderNumber) === 1 &&
      best.score >= AUTO_APPLY_MIN_SCORE &&
      !claimed.has(best.orderNumber);
    if (unique) {
      claimed.add(best.orderNumber);
      label.status = "auto";
      label.orderNumber = best.orderNumber;
      label.confidence = best.score;
      label.candidates = [];
      if (!dryRun) applyLabelToOrder(ordersByNumber.get(best.orderNumber), label, "usps-label-auto");
      autoApplied += 1;
      entry.done = true;
    }
  }

  let suggested = 0;
  let unmatched = 0;
  for (const { label, candidates, done } of open) {
    if (done) continue;
    const viable = candidates.filter((c) => !claimed.has(c.orderNumber) && c.score >= SUGGEST_MIN_SCORE);
    const named = viable.filter((c) => c.nameLevel !== "none");
    const top = (named.length ? named : viable).slice(0, 3);
    label.orderNumber = null;
    label.candidates = top;
    label.confidence = top[0]?.score || 0;
    if (top.length) {
      label.status = "suggested";
      suggested += 1;
    } else {
      label.status = "unmatched";
      unmatched += 1;
    }
  }

  const summary = {
    at: new Date().toISOString(),
    labels: store.labels.length,
    autoApplied,
    suggested,
    unmatched,
    alreadyTracked: store.labels.filter((l) => l.status === "preexisting").length,
    tcgConflicts: store.labels.filter((l) => l.status === "conflict").length,
    dismissed: store.labels.filter((l) => l.status === "dismissed").length,
    dryRun: Boolean(dryRun),
  };
  if (!dryRun) {
    store.lastMatchSummary = summary;
    if (autoApplied) writeJson(ORDERS_DB_PATH, db);
    writeJson(LABELS_PATH, store);
  }
  return summary;
}

/** Called from the Gmail sync cycle. */
export async function syncShippingLabels({ accessToken = null, full = false } = {}) {
  const scan = await scanLabelEmails({ accessToken, full });
  const match = matchLabelsToOrders();
  return { scan, match };
}

export async function backfillShippingLabels() {
  const backup = backupOrdersDb("pre-label-backfill");
  const result = await syncShippingLabels({ full: true });
  return { ...result, backup: backup ? path.relative(DATA_DIR, backup) : null };
}

function publicLabel(l) {
  return {
    tracking: l.tracking,
    service: l.service,
    recipientName: l.recipientName,
    city: l.city,
    state: l.state,
    zip: l.zip,
    labelDate: l.labelDate,
    cost: l.cost,
    status: l.status,
    orderNumber: l.orderNumber,
    confidence: l.confidence,
  };
}

export function getLabelSuggestions() {
  const store = readLabelStore();
  const db = readJsonSafe(ORDERS_DB_PATH, { orders: [] });
  const byNumber = new Map((db.orders || []).map((o) => [String(o.orderNumber || ""), o]));
  const suggestions = store.labels
    .filter((l) => l.status === "suggested")
    .sort((a, b) => String(b.labelDate).localeCompare(String(a.labelDate)))
    .map((l) => ({
      ...publicLabel(l),
      candidates: (l.candidates || []).map((c) => {
        const o = byNumber.get(c.orderNumber) || {};
        return {
          ...c,
          purchaseDate: o.purchaseDate || "",
          orderAmount: Number(o.orderAmount || 0),
          buyerName: o.buyerName || "",
          shipToName: o.shipToName || "",
          productName: o.productName || "",
        };
      }),
    }));
  return {
    suggestions,
    summary: store.lastMatchSummary,
    lastScanAt: store.lastScanAt,
    lastBackfillAt: store.lastBackfillAt,
  };
}

export function confirmLabelMatch({ tracking, orderNumber }) {
  const t = normTracking(tracking);
  const store = readLabelStore();
  const label = store.labels.find((l) => l.tracking === t);
  if (!label) throw new Error("Label not found.");
  const db = readJsonSafe(ORDERS_DB_PATH, { orders: [] });
  const order = (db.orders || []).find((o) => String(o.orderNumber || "") === String(orderNumber || ""));
  if (!order) throw new Error("Order not found.");
  const existing = String(order.trackingNumber || "").trim();
  if (existing && coreTrackingNumber(existing) !== coreTrackingNumber(t)) {
    throw new Error("That order already has a different tracking number.");
  }
  applyLabelToOrder(order, label, "usps-label-confirmed");
  label.status = "confirmed";
  label.orderNumber = order.orderNumber;
  label.candidates = [];
  writeJson(ORDERS_DB_PATH, db);
  writeJson(LABELS_PATH, store);
  matchLabelsToOrders();
  return { orderNumber: order.orderNumber, tracking: t };
}

export function dismissLabel({ tracking }) {
  const t = normTracking(tracking);
  const store = readLabelStore();
  const label = store.labels.find((l) => l.tracking === t);
  if (!label) throw new Error("Label not found.");
  label.status = "dismissed";
  label.candidates = [];
  writeJson(LABELS_PATH, store);
  return { tracking: t };
}

export function createShippingLabelsRouter() {
  const router = express.Router();
  const wrap = (fn) => async (req, res) => {
    try {
      res.json({ ok: true, ...(await fn(req)) });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  };
  router.get("/api/orders/label-matches", wrap(() => getLabelSuggestions()));
  router.post("/api/orders/label-matches/confirm", wrap((req) => ({ result: confirmLabelMatch(req.body || {}) })));
  router.post("/api/orders/label-matches/dismiss", wrap((req) => ({ result: dismissLabel(req.body || {}) })));
  router.post("/api/orders/label-matches/rematch", wrap(() => ({ result: matchLabelsToOrders() })));
  router.post("/api/orders/label-matches/backfill", wrap(async () => ({ result: await backfillShippingLabels() })));
  return router;
}
