import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import {
  addOrder,
  getInventoryDashboard,
  importOrdersFromCsv,
  importInventoryFromExcel,
  listOrders,
  refreshMarketData,
  resetInventoryAndWorkflowData,
  resetOrdersData,
  sanitizeLegacyPricechartingUrlsInInventory,
  updateOrderTrackingStatus,
  updateItemWorkflow,
} from "./inventoryAgent.js";
import {
  disconnectGmailSync,
  getGmailAuthStartUrl,
  getGmailSyncStatus,
  handleGmailAuthCallback,
  syncOrdersFromGmail,
} from "./gmailOrders.js";
import {
  autoMatchSalesToInventory,
  confirmSalesMatch,
  getInventoryStockView,
  getSalesMatches,
} from "./inventorySales.js";
import { getTaxPrepReport, saveTaxPrepSection, snapshotInventoryForTaxYear } from "./taxPrep.js";
import { importYearSheets } from "./yearSheetsImport.js";
import { getLoanReport, updateLoanMeta, addLoanPayment, deleteLoanPayment } from "./loan.js";
import {
  getSheetSyncSettings,
  readStockRows,
  saveSheetSyncSettings,
  testSheetConnection,
} from "./sheetLedger.js";
import {
  getSheetIntakeState,
  getSheetSyncHealth,
  ignoreSheetEvent,
  resolveSheetEvent,
  runSheetIntake,
  startSheetSyncScheduler,
} from "./emailIntake.js";
import { buildStoreCatalog, getStorePriceReview, startStoreCatalogScheduler, STORE_DIR } from "./storeCatalog.js";
import { cancelWebOrder, getStorePublishState, markWebOrderPaid, publishStore, startStorePublisher } from "./storePublish.js";
import { pcLease } from "./portalLease.js";
import { readWebOrders } from "./webOrders.js";
import { salesTaxCsv, salesTaxReport } from "./salesTaxReport.js";
import { readDrafts, updateDraft } from "./storeMarketing.js";
import { PROMO_DIR, listPromoProducts, listPromoShorts, makePromoShort } from "./promoShorts.js";
import { createWeeklyShortsRouter, startWeeklyShortsScheduler } from "./weeklyShorts.js";
import { createLimitedItemsRouter } from "./limitedItems.js";
import { createRaiseAfterSaleRouter } from "./raiseAfterSale.js";
import { createZeeRouter } from "./zee/router.js";
import { createShippingLabelsRouter } from "./shippingLabels.js";
import { addFollowupIfMissing, logOpenFollowups } from "./zee/followups.js";
import {
  addTreasureDeal,
  deleteTreasureDeal,
  getTreasureHuntState,
  getTreasureSummary,
  listTreasureInventorySkus,
  markTreasureScanSeen,
  runTreasureDealScan,
  startPassiveTreasureScanScheduler,
  updateTreasureDeal,
} from "./treasureHunt.js";

function hydrateUserEnvVars(varNames) {
  if (process.platform !== "win32") return;
  for (const name of varNames) {
    if (String(process.env[name] || "").trim()) continue;
    try {
      const ps = `[Environment]::GetEnvironmentVariable('${name}','User')`;
      const val = String(execSync(`powershell -NoProfile -Command "${ps}"`, { encoding: "utf8" }) || "").trim();
      if (val) process.env[name] = val;
    } catch {
      // Best-effort only; leave missing vars untouched.
    }
  }
}

hydrateUserEnvVars([
  "OPENAI_API_KEY",
  "OPENAI_REALTIME_MODEL",
  "OPENAI_REALTIME_VOICE",
  "STOCKS_API_KEY",
  "FINNHUB_API_KEY",
  "NEWS_API_KEY",
  "GMAIL_CLIENT_ID",
  "GMAIL_CLIENT_SECRET",
  "GMAIL_REDIRECT_URI",
  "ZEE_GMAIL_REDIRECT_URI",
  "ZEE_MUSIC_ROOT",
  "ZEE_AUDI_IMAGE_PATH",
  "ZEE_AUDI_EMAIL",
  "ZEE_AUDI_PASSWORD",
  "ZEE_AUDI_VIN",
  "ZEE_AUDI_COUNTRY",
  "ZEE_NETGEAR_PASSWORD",
  "ZEE_NETGEAR_USER",
  "ZEE_NETGEAR_SOAP_URL",
  "ZEE_NETGEAR_FORCE_LOGIN_V2",
  "ZEE_HOME_NETWORK_TARGETS",
  "ZEE_SMARTTHINGS_TOKEN",
  "ZEE_SMARTTHINGS_LOCATION_ID",
  "ZEE_SMARTTHINGS_CLIENT_ID",
  "ZEE_SMARTTHINGS_CLIENT_SECRET",
  "ZEE_SMARTTHINGS_REDIRECT_URI",
  "ZEE_FACEBOOK_PAGE_ID",
  "ZEE_FACEBOOK_PAGE_TOKEN",
  "ZEE_INSTAGRAM_USER_ID",
  "ZEE_INSTAGRAM_TOKEN",
  "ZEE_META_GRAPH_VERSION",
]);

sanitizeLegacyPricechartingUrlsInInventory();

const app = express();
const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const INVENTORY_IMPORTS_DIR = path.join(SERVER_DIR, "..", "data", "imports");

function safeInventoryUploadName(name) {
  return String(name || "inventory.xlsx")
    .replace(/[^a-zA-Z0-9._ -]/g, "_")
    .slice(0, 120);
}

app.post(
  "/api/inventory/import-upload",
  express.raw({ type: () => true, limit: "50mb" }),
  (req, res) => {
    try {
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        res.status(400).json({ ok: false, error: "Empty upload." });
        return;
      }
      let originalName = "inventory.xlsx";
      try {
        const raw = req.get("X-Original-Filename") || "";
        if (raw) originalName = decodeURIComponent(raw);
      } catch {
        /* ignore bad header */
      }
      const ext = path.extname(originalName).toLowerCase();
      if (ext && ![".xlsx", ".xls"].includes(ext)) {
        res.status(400).json({ ok: false, error: "Only .xlsx or .xls files are supported." });
        return;
      }
      fs.mkdirSync(INVENTORY_IMPORTS_DIR, { recursive: true });
      const dest = path.join(
        INVENTORY_IMPORTS_DIR,
        `${Date.now()}-${safeInventoryUploadName(originalName)}`
      );
      fs.writeFileSync(dest, req.body);
      const result = importInventoryFromExcel(dest);
      res.json({ ok: true, result });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  }
);

app.use(express.json());
app.use(express.static("public"));
app.use("/store", express.static(STORE_DIR));
app.post("/api/store/rebuild", async (_req, res) => {
  try {
    const catalog = await buildStoreCatalog();
    res.json({ ok: true, count: catalog.count, updatedAt: catalog.updatedAt });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});
app.get("/api/store/price-review", (_req, res) => {
  res.json({ ok: true, ...getStorePriceReview() });
});
app.post("/api/store/publish", async (req, res) => {
  res.json({ ok: true, ...(await publishStore({ forceDeploy: Boolean(req.body?.forceDeploy) })) });
});
app.get("/api/store/publish", (_req, res) => {
  res.json({ ok: true, ...getStorePublishState() });
});
app.get("/api/portal-lease", async (_req, res) => {
  const s = pcLease.status();
  res.json({ ok: true, ...(s.checkedAt ? s : await pcLease.checkLease()) });
});
// Owner take-back after the lease expired (or was handed back). Loopback only; the custom header forces a CORS
// preflight, so another website open in the browser can't trigger it.
app.post("/api/portal-lease/take", async (req, res) => {
  const local = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress);
  if (!local || req.get("X-Portal-Owner") !== "1") return res.status(403).json({ ok: false, error: "Only from the portal on this PC." });
  try {
    res.json({ ok: true, ...(await pcLease.takeLease("pc owner (localhost)")) });
  } catch (e) {
    res.status(409).json({ ok: false, error: e.message });
  }
});
app.get("/api/store/web-orders", (_req, res) => {
  res.json({ ok: true, orders: readWebOrders().slice().reverse() });
});
app.get("/api/store/sales-tax", (req, res) => {
  const range = /^\d{4}-\d{2}-\d{2}$/;
  const from = range.test(req.query.from || "") ? req.query.from : "";
  const to = range.test(req.query.to || "") ? req.query.to : "";
  const report = salesTaxReport({ from, to });
  if (req.query.format !== "csv") return res.json({ ok: true, ...report });
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="sales-tax-${from || "start"}-to-${to || "today"}.csv"`);
  res.send(salesTaxCsv(report));
});
app.get("/api/store/web-orders/:id", (req, res) => {
  const order = readWebOrders().find((o) => o.id === req.params.id);
  if (!order) return res.status(404).json({ ok: false, error: "Order not found." });
  res.json({ ok: true, order });
});
app.post("/api/store/web-orders/:id/mark-paid", async (req, res) => {
  try {
    res.json({ ok: true, ...(await markWebOrderPaid(req.params.id)) });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});
app.post("/api/store/web-orders/:id/cancel", async (req, res) => {
  try {
    res.json({ ok: true, ...(await cancelWebOrder(req.params.id)) });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});
app.get("/api/marketing/drafts", (_req, res) => {
  res.json({ ok: true, drafts: readDrafts().slice().reverse() });
});
app.post("/api/marketing/drafts/:id", (req, res) => {
  try {
    res.json({ ok: true, draft: updateDraft(req.params.id, req.body || {}) });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});
app.use("/promo-shorts", express.static(PROMO_DIR));
app.get("/api/marketing/promo-shorts", (_req, res) => {
  res.json({ ok: true, shorts: listPromoShorts(), products: listPromoProducts() });
});
app.post("/api/marketing/promo-shorts", async (req, res) => {
  try {
    res.json({ ok: true, short: await makePromoShort(req.body?.productId, { hook: req.body?.hook, sticker: req.body?.sticker }) });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});
app.use(createWeeklyShortsRouter());
app.use(createLimitedItemsRouter());
app.use(createRaiseAfterSaleRouter());
app.use("/api/zee", createZeeRouter());
app.use(createShippingLabelsRouter());
app.get("/zee", (_req, res) => {
  res.sendFile("zee.html", { root: "public" });
});
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/inventory", (_req, res) => {
  res.sendFile("inventory-import.html", { root: "public" });
});

app.post("/api/inventory/import", (req, res) => {
  try {
    const filePath = String(req.body?.filePath || "").trim();
    if (!filePath) {
      res.status(400).json({ ok: false, error: "filePath is required." });
      return;
    }
    const result = importInventoryFromExcel(filePath);
    res.json({ ok: true, result });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.post("/api/inventory/refresh-prices", async (req, res) => {
  try {
    const result = await refreshMarketData();
    res.json({ ok: true, result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/reset/inventory-workflow", (_req, res) => {
  try {
    const result = resetInventoryAndWorkflowData();
    res.json({ ok: true, result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/reset/orders", (_req, res) => {
  try {
    const result = resetOrdersData();
    res.json({ ok: true, result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/inventory/dashboard", (_req, res) => {
  try {
    const data = getInventoryDashboard();
    res.json({ ok: true, data });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/inventory/stock", (_req, res) => {
  try {
    const data = getInventoryStockView();
    res.json({ ok: true, data });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/inventory/sales-matches", (_req, res) => {
  try {
    const data = getSalesMatches();
    res.json({ ok: true, data });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/inventory/sales-matches", (req, res) => {
  try {
    const result = confirmSalesMatch(req.body || {});
    const stock = getInventoryStockView();
    res.json({ ok: true, result, data: stock });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.post("/api/inventory/sales-matches/auto", (_req, res) => {
  try {
    const result = autoMatchSalesToInventory();
    res.json({ ok: true, result, data: getInventoryStockView() });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/treasure-hunt", (_req, res) => {
  try {
    res.json({ ok: true, ...getTreasureHuntState() });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/treasure-hunt/summary", (_req, res) => {
  try {
    res.json({ ok: true, ...getTreasureSummary() });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/treasure-hunt/scan", async (req, res) => {
  try {
    const scan = await runTreasureDealScan(req.body || {});
    res.json({ ok: true, scan });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/treasure-hunt/mark-seen", (_req, res) => {
  try {
    const result = markTreasureScanSeen();
    res.json({ ok: true, result });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.get("/api/treasure-hunt/inventory-skus", (_req, res) => {
  try {
    res.json({ ok: true, skus: listTreasureInventorySkus() });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/treasure-hunt", (req, res) => {
  try {
    const deal = addTreasureDeal(req.body || {});
    res.json({ ok: true, deal });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.patch("/api/treasure-hunt/:id", (req, res) => {
  try {
    const deal = updateTreasureDeal(req.params.id, req.body || {});
    res.json({ ok: true, deal });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.delete("/api/treasure-hunt/:id", (req, res) => {
  try {
    deleteTreasureDeal(req.params.id);
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.post("/api/inventory/workflow", (req, res) => {
  try {
    const result = updateItemWorkflow(req.body || {});
    res.json({ ok: true, result });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.get("/api/orders", (_req, res) => {
  try {
    res.json({ ok: true, orders: listOrders() });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/orders", (req, res) => {
  try {
    const order = addOrder(req.body || {});
    res.json({ ok: true, order });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.post("/api/orders/import-csv", (req, res) => {
  try {
    const filePath = String(req.body?.filePath || "").trim();
    const replaceExisting = Boolean(req.body?.replaceExisting);
    if (!filePath) {
      res.status(400).json({ ok: false, error: "filePath is required." });
      return;
    }
    const result = importOrdersFromCsv(filePath, { replaceExisting });
    res.json({ ok: true, result });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.post("/api/orders/tracking-status", (req, res) => {
  try {
    const result = updateOrderTrackingStatus(req.body || {});
    res.json({ ok: true, order: result });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.get("/api/orders/gmail/status", (_req, res) => {
  try {
    res.json({ ok: true, status: getGmailSyncStatus() });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

let gmailAuthReturnPage = "/inventory-orders.html";

app.get("/api/orders/gmail/auth/start", (req, res) => {
  try {
    const authUrl = getGmailAuthStartUrl();
    gmailAuthReturnPage =
      req.query?.return === "sheet-sync" ? "/inventory-sheet-sync.html" : "/inventory-orders.html";
    res.json({ ok: true, authUrl });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.get("/api/orders/gmail/auth/callback", async (req, res) => {
  try {
    await handleGmailAuthCallback({
      code: req.query?.code,
      state: req.query?.state,
    });
    res.send(`<!doctype html><html><body><script>window.location.href="${gmailAuthReturnPage}?gmail=connected";</script>Gmail connected. You can close this tab.</body></html>`);
  } catch (error) {
    res.status(400).send(`Gmail connect failed: ${String(error.message || error)}`);
  }
});

app.post("/api/orders/gmail/disconnect", (_req, res) => {
  try {
    const result = disconnectGmailSync();
    res.json({ ok: true, result });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.post("/api/orders/gmail/sync", async (req, res) => {
  try {
    const result = await syncOrdersFromGmail(req.body || {});
    res.json({ ok: true, result });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.get("/api/tax-prep", (req, res) => {
  try {
    const year = Number(req.query?.year) || new Date().getFullYear();
    res.json({ ok: true, data: getTaxPrepReport(year) });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.put("/api/tax-prep/:section", (req, res) => {
  try {
    const section = String(req.params.section || "").trim();
    const year = Number(req.body?.year) || new Date().getFullYear();
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    const data = saveTaxPrepSection(year, section, rows);
    res.json({ ok: true, data });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.post("/api/tax-prep/snapshot-inventory", (req, res) => {
  try {
    const year = Number(req.body?.year) || new Date().getFullYear();
    const target = String(req.body?.target || "ending").trim();
    const data = snapshotInventoryForTaxYear(year, target);
    res.json({ ok: true, data });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.post("/api/inventory/import-year-sheets", (req, res) => {
  try {
    const body = req.body || {};
    const result = importYearSheets({
      inventory2025Path: body.inventory2025Path,
      inventory2026Path: body.inventory2026Path,
      sold2025Path: body.sold2025Path,
      sold2026Path: body.sold2026Path,
      clearSalesLedger: body.clearSalesLedger !== false,
    });
    res.json({ ok: true, result });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.get("/api/sheet-sync", (_req, res) => {
  try {
    res.json({
      ok: true,
      data: { settings: getSheetSyncSettings(), gmail: getGmailSyncStatus(), ...getSheetIntakeState() },
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/sheet-sync/health", (_req, res) => {
  try {
    res.json({ ok: true, data: getSheetSyncHealth() });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.put("/api/sheet-sync/settings", (req, res) => {
  try {
    res.json({ ok: true, data: saveSheetSyncSettings(req.body || {}) });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.post("/api/sheet-sync/test", async (_req, res) => {
  try {
    res.json({ ok: true, data: await testSheetConnection() });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.get("/api/sheet-sync/rows", async (_req, res) => {
  try {
    const rows = await readStockRows();
    res.json({ ok: true, data: rows.map((r) => ({ tab: r.tab, itemId: r.itemId, qty: r.qty, cost: r.cost })) });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.post("/api/sheet-sync/run", async (_req, res) => {
  try {
    res.json({ ok: true, data: await runSheetIntake({ trigger: "manual" }) });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.post("/api/sheet-sync/events/:id/resolve", async (req, res) => {
  try {
    res.json({ ok: true, data: await resolveSheetEvent(req.params.id, req.body || {}) });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.post("/api/sheet-sync/events/:id/ignore", (req, res) => {
  try {
    res.json({ ok: true, data: ignoreSheetEvent(req.params.id) });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.get("/api/loan", (_req, res) => {
  try {
    res.json({ ok: true, data: getLoanReport() });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.put("/api/loan", (req, res) => {
  try {
    const data = updateLoanMeta(req.body || {});
    res.json({ ok: true, data });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.post("/api/loan/payments", (req, res) => {
  try {
    const data = addLoanPayment(req.body || {});
    res.json({ ok: true, data });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.delete("/api/loan/payments/:id", (req, res) => {
  try {
    const data = deleteLoanPayment(req.params.id);
    res.json({ ok: true, data });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

// Store portal only — card-game / socket.io prototypes removed.
app.get("/", (_req, res) => {
  res.redirect(302, "/inventory-stock.html");
});

// Seed Zee follow-ups (idempotent — safe to call every boot).
try {
  addFollowupIfMissing({
    title: "Set ZEE_ZOOM_PERSONAL_URL so quick Zoom calls reuse your PMI",
    notes: "powershell: [Environment]::SetEnvironmentVariable('ZEE_ZOOM_PERSONAL_URL','https://us04web.zoom.us/j/...','User'). Then restart the server.",
    tag: "comm.zoom_pmi",
  });
  addFollowupIfMissing({
    title: "Re-authorize Gmail with gmail.send so meeting invites send directly",
    notes: "Disconnect Gmail in HUD, reconnect via /api/zee/gmail/auth/start. Scope already requests gmail.send.",
    tag: "comm.gmail_send",
  });
} catch (e) {
  console.warn("[zee-followups] could not seed:", e.message || e);
}

const PORT = process.env.PORT || 5173;
app.listen(PORT, () => {
  console.log(`PreEminent Store portal running on http://localhost:${PORT}`);
  startPassiveTreasureScanScheduler();
  startSheetSyncScheduler();
  startStoreCatalogScheduler();
  startStorePublisher();
  startWeeklyShortsScheduler();
  try { logOpenFollowups(); } catch { /* non-fatal */ }
});

