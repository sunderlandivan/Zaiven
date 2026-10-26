import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { buildStoreCatalog, getStoreSettings, inStockCatalog, CATALOG_PATH, STOCK_PATH, STORE_DIR } from "./storeCatalog.js";
import { runSheetIntake } from "./emailIntake.js";
import { readWebOrders, saveWebOrders } from "./webOrders.js";
import { notifyDesktop } from "./desktopNotify.js";
import { CF_DIR, kvDelete, kvGetJson, kvList, kvPutMany, wrangler } from "./cloudflareKv.js";
import { pullMarketingDrafts, pushMarketingInsights } from "./storeMarketing.js";
import { pcLease } from "./portalLease.js";
import { isDeckId } from "./customDecks.js";
import { applyLimitedItemRaises, capStockItems, limitedConfig } from "./limitedItems.js";
import { scanSalesForRaises } from "./raiseAfterSale.js";
import {
  MANUAL_LABELS,
  cancelManualOrder,
  expireManualOrders,
  isCancelledOrder,
  isManualOrder,
  isPaidOrder,
  markManualOrderPaid,
  publicManualPayConfig,
} from "./manualOrders.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const STATE_PATH = path.join(ROOT, "data", "store-publish-state.json");
const QUEUE_PATH = path.join(ROOT, "data", "sheet-sync-queue.json");
// Cloudflare's free plan allows 500 deploys a month; site files rarely change (new product images, code edits).
const MIN_DEPLOY_GAP_MS = 15 * 60_000;

function readJson(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return fallback;
  }
}

const readState = () => readJson(STATE_PATH, {});
const writeState = (s) => fs.writeFileSync(STATE_PATH, JSON.stringify(s, null, 2));
const hash = (s) => crypto.createHash("sha256").update(s).digest("hex");

let pullChain = Promise.resolve();
/** Move orders from Cloudflare into data/web-orders.json. Returns the newly pulled orders. One pull at a time. */
export function pullWebOrders() {
  const run = pullChain.then(pullWebOrdersNow);
  pullChain = run.catch(() => {});
  return run;
}

async function pullWebOrdersNow() {
  const keys = await kvList("order:");
  if (!keys.length) return [];
  const orders = readWebOrders();
  const known = new Set(orders.map((o) => o.id));
  const fresh = [];
  for (const key of keys) {
    const order = await kvGetJson(key);
    if (!known.has(order.id)) {
      orders.push({ ...order, pulledAt: new Date().toISOString() });
      known.add(order.id);
      fresh.push(order);
    }
    saveWebOrders(orders);
    await kvDelete(key);
  }
  for (const o of fresh) {
    const decks = o.lines.filter((l) => isDeckId(l.id));
    const deckList = decks.map((l) => `${l.qty}× ${l.name} (eBay #${l.id.slice(5)})`).join(", ");
    if (isManualOrder(o)) {
      const label = MANUAL_LABELS[o.paymentMethod];
      if (o.status === "awaiting_payment") {
        notifyDesktop(`${label} order awaiting $${o.total.toFixed(2)}`, `Check your ${label === "Zelle" ? "bank" : "Venmo"} for memo ${o.id}. Stock is reserved for ${o.payer?.name || "the buyer"}.`);
        if (decks.length) notifyDesktop("Custom deck reserved", `Reserved on the website: ${deckList}. Pause or end the eBay listing so it can't sell twice.`);
      }
      continue;
    }
    const items = o.lines.map((l) => `${l.qty}× ${l.name}`).join(", ");
    const a = o.shipTo.address || {};
    notifyDesktop(`New website order — $${o.total.toFixed(2)}`, `${items}. Ship to ${o.shipTo.name}, ${a.admin_area_2 || ""} ${a.admin_area_1 || ""}.`);
    const singles = o.lines.filter((l) => l.single);
    if (singles.length) {
      notifyDesktop("Delist on TCGplayer", `Sold on the website: ${singles.map((l) => `${l.qty}× ${l.title}`).join(", ")}. Lower these on TCGplayer.`);
    }
    if (decks.length) notifyDesktop("End on eBay", `Custom deck sold on the website: ${deckList}. End or lower these eBay listings now.`);
  }
  return fresh;
}

/** Quantities sold on the website that the sheet doesn't reflect yet (the order hasn't been written to Sold 2026). */
function unsyncedWebQty() {
  const applied = new Set((readJson(QUEUE_PATH, {}).events || []).filter((e) => e.status === "applied").map((e) => e.id));
  const qty = new Map();
  for (const o of readWebOrders()) {
    // Unpaid Zelle/Venmo orders still hold their stock; cancelled ones released it.
    if (applied.has(`web:${o.id}`) || isCancelledOrder(o)) continue;
    for (const l of o.lines) qty.set(l.id, (qty.get(l.id) || 0) + l.qty);
  }
  return qty;
}

/** Catalog + exact stock as checkout should see them right now. */
export function currentStock() {
  const stock = readJson(STOCK_PATH, null);
  if (!stock) return null;
  for (const [id, q] of unsyncedWebQty()) if (stock.items[id]) stock.items[id].q = Math.max(0, stock.items[id].q - q);
  const settings = getStoreSettings();
  capStockItems(stock.items, limitedConfig(settings), settings.stockDisplayCaps);
  return stock;
}

/** Push catalog + exact stock to Cloudflare when either changed. */
export async function pushStoreData({ force = false } = {}) {
  const built = readJson(CATALOG_PATH, null);
  const stock = currentStock();
  if (!built || !stock) return { pushed: false, reason: "catalog not built yet" };
  const catalog = inStockCatalog(built, stock.items);

  const { updatedAt, ...catalogBody } = catalog;
  const manualPay = JSON.stringify(publicManualPayConfig());
  stock.salesTax = getStoreSettings().salesTax || { enabled: false };
  const fingerprint = hash(JSON.stringify(catalogBody) + JSON.stringify(stock.items) + JSON.stringify(stock.shipping) + JSON.stringify(stock.salesTax) + manualPay);
  const state = readState();
  if (!force && state.dataHash === fingerprint) return { pushed: false, reason: "unchanged" };

  await kvPutMany({ catalog: JSON.stringify(catalog), stock: JSON.stringify(stock), "manual-pay-config": manualPay });
  writeState({ ...readState(), dataHash: fingerprint, lastPushAt: new Date().toISOString() });
  return { pushed: true };
}

function siteFingerprint() {
  const parts = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (p !== CATALOG_PATH) {
        const st = fs.statSync(p);
        parts.push(`${path.relative(ROOT, p)}:${st.size}:${Math.floor(st.mtimeMs)}`);
      }
    }
  };
  walk(STORE_DIR);
  for (const dir of ["functions", "lib"]) {
    const base = path.join(CF_DIR, dir);
    if (fs.existsSync(base)) walk(base);
  }
  parts.push(fs.readFileSync(path.join(CF_DIR, "wrangler.toml"), "utf8"));
  return hash(parts.sort().join("\n"));
}

/** Redeploy the site (pages + checkout functions) when its files changed, at most every 15 minutes. */
export async function deploySiteIfChanged({ force = false } = {}) {
  const state = readState();
  const fingerprint = siteFingerprint();
  if (!force && state.siteHash === fingerprint) return { deployed: false, reason: "unchanged" };
  if (!force && Date.now() - Date.parse(state.lastDeployAt || 0) < MIN_DEPLOY_GAP_MS) return { deployed: false, reason: "throttled" };
  await wrangler(["pages", "deploy", "--project-name", "preeminentstore", "--branch", "main", "--commit-dirty=true"]);
  writeState({ ...readState(), siteHash: fingerprint, lastDeployAt: new Date().toISOString() });
  return { deployed: true };
}

let busy = false;

/**
 * One publish cycle: check the host lease → pull paid orders → write them to the sheet → rebuild → push stock →
 * sync marketing drafts/insights → redeploy if site files changed. Without the lease only the site redeploy runs
 * (the cloud portal never deploys the site).
 */
export async function publishStore({ forceDeploy = false } = {}) {
  if (busy) return { skipped: true };
  busy = true;
  const result = {};
  try {
    const lease = await pcLease.checkLease();
    result.lease = { holder: lease.holder, state: lease.state };
    if (!lease.holder) {
      result.passive = lease.reason;
      result.site = await deploySiteIfChanged({ force: forceDeploy });
      writeState({ ...readState(), lastRunAt: new Date().toISOString(), lastError: "", lastPassiveAt: new Date().toISOString(), lastPassiveReason: lease.reason });
      return result;
    }
    const fresh = await pullWebOrders();
    result.newOrders = fresh.length;
    result.expiredManualOrders = expireManualOrders().length;
    result.limitedRaises = applyLimitedItemRaises().length;
    if (fresh.some(isPaidOrder)) result.intake = await runSheetIntake({ trigger: "web-order" });
    if (fresh.some(isPaidOrder)) await buildStoreCatalog();
    result.data = await pushStoreData();
    result.raiseProposals = (await scanSalesForRaises().catch((e) => (console.warn("[raise-after-sale]", e.message), []))).length;
    result.drafts = await pullMarketingDrafts();
    result.insights = await pushMarketingInsights();
    result.site = await deploySiteIfChanged({ force: forceDeploy });
    writeState({ ...readState(), lastRunAt: new Date().toISOString(), lastError: "", lastPassiveReason: "" });
  } catch (e) {
    result.error = e.message;
    writeState({ ...readState(), lastRunAt: new Date().toISOString(), lastError: e.message });
    console.warn("[store-publish]", e.message);
  } finally {
    busy = false;
  }
  return result;
}

/** Portal "Mark paid": confirmation email now, then the sale goes to the Sold sheet like any paid web order. */
export async function markWebOrderPaid(id) {
  await pcLease.requireLease();
  await pullWebOrders();
  const result = await markManualOrderPaid(id);
  applyLimitedItemRaises();
  runSheetIntake({ trigger: "web-order" })
    .then(() => buildStoreCatalog())
    .then(() => pushStoreData())
    .catch((e) => console.warn("[store-publish] after mark paid:", e.message));
  return result;
}

/** Portal "Cancel": release the reserved stock on the website right away. */
export async function cancelWebOrder(id) {
  await pcLease.requireLease();
  await pullWebOrders();
  const order = cancelManualOrder(id);
  const data = await pushStoreData({ force: true });
  return { order, data };
}

export function getStorePublishState() {
  return { ...readState(), webOrders: readWebOrders().length, lease: pcLease.status() };
}

let timer = null;
export function startStorePublisher(intervalMinutes = 5) {
  if (timer) return;
  setTimeout(publishStore, 45_000);
  timer = setInterval(publishStore, intervalMinutes * 60_000);
}
