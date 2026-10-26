// Limited items: the website shows at most `maxShown` units of each listed item, and every paid website sale of one
// proposes a `raiseAfterSale` website raise for the owner's review. Off unless the owner turns it on; the Sheet quantity is never touched.
import fs from "fs";
import path from "path";
import express from "express";
import { fileURLToPath } from "url";
import { readWebOrders } from "./webOrders.js";
import { isCancelledOrder, isPaidOrder } from "./manualOrders.js";
import { notifyDesktop } from "./desktopNotify.js";
import { pcLease } from "./portalLease.js";
import { proposalId, queueProposal, readProposals, writeProposals } from "./raiseProposals.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SETTINGS_PATH = path.join(ROOT, "data", "store-settings.json");
const STOCK_PATH = path.join(ROOT, "data", "store-stock.json");
const COST_FLOORS_PATH = path.join(ROOT, "data", "store-cost-floors.json");
const HISTORY_PATH = path.join(ROOT, "data", "limited-items-history.json");

export const LIMITED_DEFAULTS = { enabled: false, maxShown: 1, raiseAfterSale: 100, itemIds: [] };

function readJson(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return fallback;
  }
}

export function limitedConfig(settings = readJson(SETTINGS_PATH, {})) {
  const c = { ...LIMITED_DEFAULTS, ...settings.limitedItems };
  return {
    ...c,
    enabled: c.enabled === true,
    maxShown: Math.max(1, Math.floor(Number(c.maxShown) || LIMITED_DEFAULTS.maxShown)),
    raiseAfterSale: Math.max(0, Number(c.raiseAfterSale) || 0),
    itemIds: (Array.isArray(c.itemIds) ? c.itemIds : []).map(String),
  };
}

/** Quantity the website may show for one item. */
export function shownQty(id, qty, cfg) {
  return cfg.enabled && cfg.itemIds.includes(String(id)) ? Math.min(qty, cfg.maxShown) : qty;
}

/**
 * Caps the `q` of listed items in a stock map ({ id: { q, ... } }) in place. `displayCaps` ({ id: max }) is a plain
 * per-item display limit with no price raises, applied even when the limited-items rule is off.
 */
export function capStockItems(items, cfg, displayCaps = {}) {
  for (const [id, max] of Object.entries(displayCaps || {})) {
    const n = Math.floor(Number(max));
    if (items[id] && n >= 1) items[id].q = Math.min(items[id].q, n);
  }
  if (!cfg.enabled) return items;
  for (const id of cfg.itemIds) if (items[id]) items[id].q = shownQty(id, items[id].q, cfg);
  return items;
}

const to99 = (n) => Math.round((Math.floor(n + 1e-9) + 0.99) * 100) / 100;
const orderTime = (o) => o.paidAt || o.createdAt || o.pulledAt || "";

/**
 * Raises owed for paid website orders since the rule was turned on. One raise per item per order (keyed in the
 * history), always up from the higher of the current site price, the override and the price paid, never below the
 * floor at the item's highest unit cost (pricing rule) or the site's own floor.
 */
export function planRaises({ cfg, orders, stockItems, overrides, history, costFloors = {} }) {
  if (!cfg.enabled || !cfg.raiseAfterSale || !cfg.itemIds.length) return [];
  const done = new Set(history.map((h) => h.key));
  const price = { ...overrides };
  const raises = [];
  for (const o of orders) {
    if (o.test || !isPaidOrder(o) || isCancelledOrder(o)) continue;
    if (!cfg.enabledAt || orderTime(o) < cfg.enabledAt) continue;
    for (const id of new Set(o.lines.map((l) => String(l.id)))) {
      const key = `${o.id}:${id}`;
      if (!cfg.itemIds.includes(id) || done.has(key)) continue;
      const line = o.lines.find((l) => String(l.id) === id);
      const s = stockItems[id] || {};
      const from = Math.max(Number(s.p) || 0, Number(price[id]) || 0, Number(line.price) || 0);
      if (!from) continue;
      const to = to99(Math.max(from + cfg.raiseAfterSale, Number(s.f) || 0, Number(costFloors[id]?.floor) || 0));
      if (to <= from) continue;
      raises.push({ key, orderId: o.id, itemId: id, name: line.name || s.n || id, from, to, qty: Number(line.qty) || 1, paid: Number(line.price) || 0, date: orderTime(o).slice(0, 10) });
      price[id] = to;
      done.add(key);
    }
  }
  return raises;
}

const defaultIo = {
  holdsLease: () => pcLease.holdsLease(),
  readSettings: () => readJson(SETTINGS_PATH, {}),
  writeSettings: (s) => fs.writeFileSync(SETTINGS_PATH, JSON.stringify(s, null, 2)),
  readOrders: readWebOrders,
  readStock: () => readJson(STOCK_PATH, { items: {} }).items || {},
  readCostFloors: () => readJson(COST_FLOORS_PATH, { items: {} }).items || {},
  readHistory: () => readJson(HISTORY_PATH, { raises: [] }).raises || [],
  writeHistory: (raises) => fs.writeFileSync(HISTORY_PATH, JSON.stringify({ raises }, null, 2)),
  readProposals,
  writeProposals,
  notify: notifyDesktop,
  now: () => new Date().toISOString(),
};

const REVIEW_URL = "http://localhost:5173/inventory-marketing.html#raise-after-sale";

/**
 * Publish-cycle step (lease holder only): each owed raise becomes a pending proposal in the Raise after sale queue
 * (or joins the item's pending one). Prices are never written here; only the owner's Approve changes them.
 * Returns the raises, each with its `proposalId` and whether it `merged` into an existing proposal.
 */
export function applyLimitedItemRaises(deps = {}) {
  const io = { ...defaultIo, ...deps };
  if (!io.holdsLease()) return [];
  const settings = io.readSettings();
  const cfg = limitedConfig(settings);
  const history = io.readHistory();
  const locked = settings.lockedPrices || {};
  const current = { ...settings.priceOverrides };
  for (const [id, p] of Object.entries(locked)) current[id] = Math.max(Number(current[id]) || 0, Number(p) || 0);
  const stock = io.readStock();
  const costFloors = io.readCostFloors();
  const raises = planRaises({ cfg, orders: io.readOrders(), stockItems: stock, overrides: current, history, costFloors });
  if (!raises.length) return [];
  const at = io.now();
  const state = io.readProposals();
  const out = raises.map((r) => {
    const s = stock[r.itemId] || {};
    const { proposal, merged } = queueProposal(state, {
      id: proposalId(r.itemId),
      itemId: r.itemId,
      title: s.t || r.name,
      createdAt: at,
      status: "pending",
      source: "limited-items",
      currentPrice: Number(s.p) || r.from,
      suggestedPrice: r.to,
      locked: r.itemId in locked,
      qtyLeft: Math.max(0, (Number(s.q) || 0) - r.qty),
      cost: Number(costFloors[r.itemId]?.maxCost) || 0,
      floor: Number(costFloors[r.itemId]?.floor) || Number(s.f) || 0,
      sales: [{ channel: "Website", orderNumber: r.orderId, date: r.date, qty: r.qty, price: r.paid }],
    });
    return { ...r, proposalId: proposal.id, merged };
  });
  io.writeProposals(state);
  io.writeHistory([...history, ...out.map((r) => ({ at, proposed: true, ...r }))]);
  for (const r of out.filter((x) => !x.merged)) {
    io.notify("Limited item sold: raise to review", `${r.name} sold on the website (order ${r.orderId}). Suggested $${r.from.toFixed(2)} → $${r.to.toFixed(2)}. Nothing changes until you approve it on Marketing.`, REVIEW_URL);
  }
  return out;
}

/** Owner on/off. Turning it on stamps `enabledAt`, so only sales after that moment raise prices. */
export function setLimitedEnabled(enabled, io = defaultIo) {
  const settings = io.readSettings();
  const cur = limitedConfig(settings);
  const next = { ...LIMITED_DEFAULTS, ...settings.limitedItems, enabled: Boolean(enabled) };
  if (enabled && !cur.enabled) next.enabledAt = io.now();
  io.writeSettings({ ...settings, limitedItems: next });
  return limitedConfig({ limitedItems: next });
}

export function limitedItemsView() {
  const settings = readJson(SETTINGS_PATH, {});
  const cfg = limitedConfig(settings);
  const stock = defaultIo.readStock();
  const items = cfg.itemIds.map((id) => {
    const s = stock[id];
    return { id, name: s?.n || id, price: s?.p ?? null, override: settings.priceOverrides?.[id] ?? null, qty: s?.q ?? 0, shown: s ? shownQty(id, s.q, cfg) : 0 };
  });
  return { config: cfg, items, history: defaultIo.readHistory().slice().reverse() };
}

export function createLimitedItemsRouter() {
  const router = express.Router();
  router.get("/api/store/limited-items", (_req, res) => res.json({ ok: true, ...limitedItemsView() }));
  // Loopback plus a custom header (forces a CORS preflight), so only the owner's portal on this PC can flip it.
  router.post("/api/store/limited-items/enabled", (req, res) => {
    const local = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress);
    if (!local || req.get("X-Portal-Owner") !== "1") return res.status(403).json({ ok: false, error: "Only the owner, from the portal on this PC." });
    res.json({ ok: true, config: setLimitedEnabled(req.body?.enabled === true) });
  });
  return router;
}
