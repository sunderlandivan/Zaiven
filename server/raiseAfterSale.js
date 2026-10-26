// Raise after sale: when a sealed item sells on any channel and stock remains, queue a website price-raise proposal
// for the owner. Nothing is applied until the owner approves it on the portal (pricing-owner-approval rule).
import fs from "fs";
import path from "path";
import express from "express";
import { fileURLToPath } from "url";
import { COST_FLOORS_PATH, FIRST_SEEN_PATH, STOCK_PATH, getStoreSettings, labelKind, worstCaseTaxRate } from "./storeCatalog.js";
import { productDetails, productIdFromUrl } from "./tcgplayerCatalog.js";
import { isDeckId } from "./customDecks.js";
import { limitedConfig } from "./limitedItems.js";
import { notifyDesktop } from "./desktopNotify.js";
import { pcLease } from "./portalLease.js";
import { proposalId, queueProposal, readProposals, writeProposals } from "./raiseProposals.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SETTINGS_PATH = path.join(ROOT, "data", "store-settings.json");
const QUEUE_PATH = path.join(ROOT, "data", "sheet-sync-queue.json");
const PORTAL_URL = "http://localhost:5173/inventory-marketing.html#raise-after-sale";

export const RAISE_DEFAULTS = { enabled: true, raise: 20, cheapBelow: 100, cheapPct: 0.12, minRaise: 2, lookbackDays: 7 };
const CHANNELS = { tcgplayer: "TCGplayer", ebay: "eBay", web: "Website" };

function readJson(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return fallback;
  }
}

const to99 = (n) => Math.round((Math.floor(n + 1e-9) + 0.99) * 100) / 100;
const round2 = (n) => Math.round(n * 100) / 100;
const slugify = (s) => String(s).toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);

export function raiseConfig(settings = getStoreSettings()) {
  const c = { ...RAISE_DEFAULTS, ...settings.raiseAfterSale };
  return { ...c, enabled: c.enabled !== false };
}

/** Expensive items (≥ cheapBelow) get +raise; cheaper ones +cheapPct of price (at least minRaise, at most raise). Ends in .99. */
export function suggestRaise(price, cfg = RAISE_DEFAULTS) {
  const add = price >= cfg.cheapBelow ? cfg.raise : Math.min(cfg.raise, Math.max(cfg.minRaise, price * cfg.cheapPct));
  return to99(price + add);
}

/** Owner's profit math: price − PayPal fee (on price + shipping + worst-case tax) − label cost not covered by shipping − highest cost. */
export function profitAt(price, { cost, title, type }, settings = getStoreSettings()) {
  const f = settings.floor;
  const ship = Number(settings.shipping.standard) || 0;
  const label = Number(f.labels[labelKind(title, type)]) || 0;
  const fee = f.paypalPct * (price + ship + price * worstCaseTaxRate(settings.salesTax)) + f.paypalFixed;
  const profit = price - fee - Math.max(0, label - ship) - cost;
  return { fees: round2(fee), netShipping: round2(Math.max(0, label - ship)), profit: round2(profit), profitPct: cost ? round2((profit / cost) * 100) : null };
}

/** Sealed sale lines (Sheet rows sold) from applied intake events, as { key, id, title, type, channel, date, qty, price }. */
export function saleLines(events) {
  const out = [];
  for (const ev of events) {
    if (ev.kind !== "sale" || ev.status !== "applied") continue;
    (ev.lines || []).forEach((l, i) => {
      const row = l.plan?.action === "sell" ? l.plan.stockRow : null;
      if (!row || !l.applied) return;
      const pid = productIdFromUrl(row.link);
      const id = pid ? String(pid) : slugify(row.itemId);
      if (isDeckId(id)) return;
      out.push({
        key: `${ev.id}#${i}`,
        id,
        productId: pid,
        title: row.itemId,
        type: row.type || "",
        channel: CHANNELS[ev.source] || ev.vendor || ev.source,
        source: ev.source,
        orderNumber: ev.orderNumber || ev.id,
        date: ev.date,
        appliedAt: ev.appliedAt || ev.createdAt || "",
        qty: Number(l.qty) || 1,
        price: Number(l.unitPrice) || 0,
      });
    });
  }
  return out;
}

async function marketPrice(productId) {
  if (!productId) return null;
  try {
    const d = await productDetails(productId);
    return Number(d.marketPrice) || null;
  } catch {
    return null;
  }
}

/**
 * Turns new sealed sales into pending proposals. A sale waits until the stock file was rebuilt after it (so "stock
 * remains" is real), is skipped when sold out, and joins the item's pending proposal instead of making a second one.
 * Website sales of limited items are skipped: that rule already raised them.
 */
export async function scanSalesForRaises({ notify = true } = {}) {
  const settings = getStoreSettings();
  const cfg = raiseConfig(settings);
  if (!cfg.enabled) return [];
  const stock = readJson(STOCK_PATH, null);
  if (!stock?.items) return [];
  const costs = readJson(COST_FLOORS_PATH, { items: {} }).items || {};
  const firstSeen = readJson(FIRST_SEEN_PATH, {});
  const limited = limitedConfig(settings);
  const since = new Date(Date.now() - cfg.lookbackDays * 864e5).toLocaleDateString("en-CA");
  const state = readProposals();
  const created = [];
  const lines = saleLines(readJson(QUEUE_PATH, { events: [] }).events || []).filter((s) => s.date >= since && !state.seen[s.key]);

  for (const sale of lines) {
    if (sale.appliedAt > stock.updatedAt) continue;
    const mark = (why) => (state.seen[sale.key] = { at: new Date().toISOString(), result: why });
    const item = stock.items[sale.id];
    if (!item || !(item.q > 0)) {
      mark("sold out");
      continue;
    }
    if (sale.source === "web" && limited.enabled && limited.itemIds.includes(sale.id)) {
      mark("limited item: the limited-items rule proposes this raise");
      continue;
    }
    const saleInfo = { channel: sale.channel, orderNumber: sale.orderNumber, date: sale.date, qty: sale.qty, price: sale.price };
    const pending = state.proposals.find((p) => p.status === "pending" && p.itemId === sale.id);
    if (pending) {
      queueProposal(state, { itemId: sale.id, sales: [saleInfo] });
      mark(`added to pending proposal ${pending.id}`);
      continue;
    }
    const current = Number(item.p) || 0;
    const base = Math.max(current, sale.price);
    const suggested = suggestRaise(base, cfg);
    const cost = Number(costs[sale.id]?.maxCost) || 0;
    const isNew = (firstSeen[sale.id] || "") > settings.floor.reviewedOn;
    const p = {
      id: proposalId(sale.id),
      itemId: sale.id,
      title: item.t || sale.title,
      createdAt: new Date().toISOString(),
      status: "pending",
      currentPrice: current,
      suggestedPrice: suggested,
      locked: sale.id in (settings.lockedPrices || {}),
      qtyLeft: item.q,
      cost,
      floor: Number(costs[sale.id]?.floor) || Number(item.f) || 0,
      minProfitPct: (isNew ? settings.floor.minProfitNew : settings.floor.minProfitExisting) * 100,
      market: await marketPrice(sale.productId),
      atCurrent: profitAt(current, { cost, title: item.t || sale.title, type: sale.type }, settings),
      atSuggested: profitAt(suggested, { cost, title: item.t || sale.title, type: sale.type }, settings),
      type: sale.type,
      sales: [saleInfo],
    };
    queueProposal(state, p);
    mark(`proposal ${p.id}`);
    created.push(p);
  }
  // Limited-items proposals are queued without the TCGplayer market (that lookup is async); fill it in here.
  let filled = false;
  for (const p of state.proposals) {
    if (p.status !== "pending" || p.market !== undefined) continue;
    p.market = /^\d+$/.test(p.itemId) ? await marketPrice(Number(p.itemId)) : null;
    filled = true;
  }
  if (lines.length || filled) writeProposals(state);
  if (notify && created.length) {
    const one = created[0];
    notifyDesktop(
      "Price raise to review",
      created.length === 1
        ? `${one.title} sold on ${one.sales[0].channel}. Suggest $${one.currentPrice.toFixed(2)} → $${one.suggestedPrice.toFixed(2)} on the website. Review on Marketing.`
        : `${created.length} items sold and still have stock. Review the suggested website raises on Marketing.`,
      PORTAL_URL
    );
  }
  return created;
}

/** Profit fields for proposals queued without them (limited items), computed on read. */
function withProfit(p, settings, firstSeen) {
  if (p.atSuggested) return p;
  const it = { cost: Number(p.cost) || 0, title: p.title, type: p.type || "" };
  const isNew = (firstSeen[p.itemId] || "") > settings.floor.reviewedOn;
  return {
    ...p,
    minProfitPct: (isNew ? settings.floor.minProfitNew : settings.floor.minProfitExisting) * 100,
    atCurrent: profitAt(p.currentPrice, it, settings),
    atSuggested: profitAt(p.suggestedPrice, it, settings),
  };
}

export function listRaiseProposals() {
  const settings = getStoreSettings();
  const stock = readJson(STOCK_PATH, { items: {} }).items || {};
  const firstSeen = readJson(FIRST_SEEN_PATH, {});
  const proposals = readProposals()
    .proposals.map((p) => ({ ...withProfit(p, settings, firstSeen), livePrice: stock[p.itemId]?.p ?? null }))
    .sort((a, b) => (a.status === "pending" ? 0 : 1) - (b.status === "pending" ? 0 : 1) || b.createdAt.localeCompare(a.createdAt));
  return { config: raiseConfig(settings), pending: proposals.filter((p) => p.status === "pending").length, proposals: proposals.slice(0, 60) };
}

/**
 * Owner approve: re-reads the settings file right before writing and changes only this item's price keys. The price
 * goes into priceOverrides, and into lockedPrices too when the item is owner-locked (the owner's OK moves the lock).
 */
export async function approveRaise(id, { price } = {}) {
  const state = readProposals();
  const p = state.proposals.find((x) => x.id === id);
  if (!p) throw new Error("Proposal not found.");
  if (p.status !== "pending") throw new Error(`Already ${p.status}.`);
  const asked = Number(price ?? p.suggestedPrice);
  if (!(asked > 0)) throw new Error("Enter a price.");
  const next = to99(asked);
  const stock = readJson(STOCK_PATH, { items: {} }).items || {};
  const live = Number(stock[p.itemId]?.p) || p.currentPrice;
  if (next < live) throw new Error(`The website price is now $${live.toFixed(2)}, above $${next.toFixed(2)}. Reload and pick a higher price, or Skip.`);
  if (p.floor && next < p.floor) throw new Error(`$${next.toFixed(2)} is below the profit floor $${p.floor.toFixed(2)}.`);

  const settings = readJson(SETTINGS_PATH, {});
  const priceOverrides = { ...settings.priceOverrides, [p.itemId]: next };
  const patch = { priceOverrides };
  if (settings.lockedPrices && p.itemId in settings.lockedPrices) patch.lockedPrices = { ...settings.lockedPrices, [p.itemId]: next };
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify({ ...settings, ...patch }, null, 2));

  Object.assign(p, { status: "approved", decidedAt: new Date().toISOString(), from: live, to: next });
  writeProposals(state);

  const { buildStoreCatalog } = await import("./storeCatalog.js");
  const { publishStore } = await import("./storePublish.js");
  await buildStoreCatalog();
  const publish = await publishStore();
  return { proposal: p, publish: { pushed: publish.data?.pushed ?? false, skipped: Boolean(publish.skipped), error: publish.error || "" } };
}

export function skipRaise(id) {
  const state = readProposals();
  const p = state.proposals.find((x) => x.id === id);
  if (!p) throw new Error("Proposal not found.");
  if (p.status !== "pending") throw new Error(`Already ${p.status}.`);
  Object.assign(p, { status: "skipped", decidedAt: new Date().toISOString() });
  writeProposals(state);
  return { proposal: p };
}

const loopback = (req) => ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress);
function ownerOnly(req, res, next) {
  if (!loopback(req) || req.get("X-Portal-Owner") !== "1") return res.status(403).json({ ok: false, error: "Only the owner, from the portal on this PC." });
  next();
}
const wrap = (fn) => async (req, res) => {
  try {
    res.json({ ok: true, ...(await fn(req)) });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
};

export function createRaiseAfterSaleRouter() {
  const r = express.Router();
  r.get("/api/store/raise-proposals", ownerOnly, wrap(() => listRaiseProposals()));
  r.get("/api/store/raise-proposals/count", wrap(() => ({ pending: readProposals().proposals.filter((p) => p.status === "pending").length })));
  r.post("/api/store/raise-proposals/scan", ownerOnly, wrap(async () => ({ created: (await scanSalesForRaises()).length, ...listRaiseProposals() })));
  r.post("/api/store/raise-proposals/:id/approve", ownerOnly, wrap(async (req) => {
    await pcLease.requireLease();
    return approveRaise(req.params.id, req.body || {});
  }));
  r.post("/api/store/raise-proposals/:id/skip", ownerOnly, wrap((req) => skipRaise(req.params.id)));
  return r;
}
