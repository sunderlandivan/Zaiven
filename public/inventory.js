const $ = (id) => document.getElementById(id);
const page = document.body.dataset.page || "import";

const filePathEl = $("filePath");
const importBtn = $("importBtn");
const scanBtn = $("scanBtn");
const reloadBtn = $("reloadBtn");
const resetInventoryBtn = $("resetInventoryBtn");
const resetOrdersBtn = $("resetOrdersBtn");
const ordersCsvPathEl = $("ordersCsvPath");
const importOrdersCsvBtn = $("importOrdersCsvBtn");
const replaceOrdersCsvBtn = $("replaceOrdersCsvBtn");
const connectGmailBtn = $("connectGmailBtn");
const disconnectGmailBtn = $("disconnectGmailBtn");
const syncGmailBtn = $("syncGmailBtn");
const syncGmailFullBtn = $("syncGmailFullBtn");
const gmailSyncStatusEl = $("gmailSyncStatus");
const totalsEl = $("totals");
const recTableBody = document.querySelector("#recTable tbody");
const recGrandTotalEl = $("recGrandTotal");
const analyticsTableBody = document.querySelector("#analyticsTable tbody");
const sellWeekTableBody = document.querySelector("#sellWeekTable tbody");
const losersTableBody = document.querySelector("#losersTable tbody");
const categoryFilterEl = $("categoryFilter");
const minProfitFilterEl = $("minProfitFilter");
const statusEl = $("status");
const orderForm = $("orderForm");
const ordersTableBody = document.querySelector("#ordersTable tbody");
const ordersSearchInput = $("ordersSearchInput");
const ordersTrackingStatusFilter = $("ordersTrackingStatusFilter");
const ordersDateFrom = $("ordersDateFrom");
const ordersDateTo = $("ordersDateTo");
const ordersFilterCountEl = $("ordersFilterCount");
let lastDashboard = null;
let lastOrdersRaw = [];
let ordersSearchDebounce = null;

function money(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  const formatted = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return n < 0 ? `-$${formatted}` : `$${formatted}`;
}
const moneyEstimated = money;

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Plain tracking # → link to USPS Track & Confirm (opens in new tab). */
function uspsTrackingCell(trackingNumber) {
  const t = String(trackingNumber || "").trim();
  if (!t) return "";
  const href = `https://tools.usps.com/go/TrackConfirmAction?qtc_tLabels1=${encodeURIComponent(t)}`;
  return `<a href="${href}" target="_blank" rel="noopener noreferrer">${escapeHtml(t)}</a>`;
}

function setStatus(text) {
  if (statusEl) statusEl.textContent = text;
}

function getGameCategory(productName) {
  const n = String(productName || "").toLowerCase();
  if (n.includes("pokemon") || n.includes("pok ")) return "pokemon";
  if (n.includes("final fantasy") || n.includes("finalfantasy") || n.includes(" ff ") || n.startsWith("ff ")) return "final fantasy";
  if (n.includes("lorcana")) return "lorcana";
  if (n.includes("one piece")) return "one piece";
  if (n.includes("magic") || n.includes("mtg")) return "magic";
  if (n.includes("yugioh") || n.includes("yu-gi-oh")) return "yugioh";
  return "other";
}

function confidenceScore(item) {
  const profit = Number(item.metrics.bestProfitPerUnit || 0);
  const margin = Number(item.metrics.bestMarginPct || 0);
  const known = item.metrics.marketPriceKnown ? 1 : 0;
  const qtyFactor = Math.min(20, Number(item.quantity || 0));
  const base = known * 40 + Math.max(0, Math.min(40, margin)) + Math.max(0, Math.min(30, profit / 2)) + qtyFactor;
  return Math.max(0, Math.min(100, Math.round(base)));
}

function confidenceBreakdown(item) {
  const marketPoints = item.metrics.marketPriceKnown ? 40 : 0;
  const marginPoints = Math.max(0, Math.min(40, Number(item.metrics.bestMarginPct || 0)));
  const profitPoints = Math.max(0, Math.min(30, Number(item.metrics.bestProfitPerUnit || 0) / 2));
  const qtyPoints = Math.min(20, Number(item.quantity || 0));
  return `Market data: ${marketPoints}/40, Margin: ${marginPoints.toFixed(
    1
  )}/40, Profit: ${profitPoints.toFixed(1)}/30, Qty: ${qtyPoints}/20`;
}

function workflowStatusBadge(item) {
  const status = item.workflow?.status || "none";
  if (status === "sold") return '<span class="status-badge sold">Sold</span>';
  if (status === "listed") return '<span class="status-badge listed">Listed</span>';
  return '<span class="status-badge none">None</span>';
}

function sourceCell(item) {
  const label = item.metrics.sourceLabel || "—";
  const url = item.metrics.sourceUrl;
  if (!url) return label;
  return `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`;
}

const TCGPLAYER_FAVICON = "https://www.tcgplayer.com/favicon.ico";

function tcgplayerThumbUrlFromProductId(productId) {
  const id = String(productId || "").trim();
  if (!/^\d+$/.test(id)) return null;
  return `https://product-images.tcgplayer.com/fit-in/200x200/filters:quality(80)/${id}.jpg`;
}

function tcgplayerThumbUrlFromSourceUrl(sourceUrl) {
  if (!sourceUrl) return null;
  const m = String(sourceUrl).match(/\/product\/(\d+)/);
  return m ? tcgplayerThumbUrlFromProductId(m[1]) : null;
}

function previewCell(item) {
  const linkUrl = item.metrics.sourceUrl;
  const imgSrc =
    item.metrics.productImageUrl ||
    tcgplayerThumbUrlFromSourceUrl(item.metrics.sourceUrl) ||
    TCGPLAYER_FAVICON;
  const safeFallback = TCGPLAYER_FAVICON.replace(/'/g, "\\'");
  const img = `<img class="thumb-img" src="${imgSrc}" alt="" loading="lazy" onerror="this.onerror=null;this.src='${safeFallback}'" />`;
  if (!linkUrl) return img;
  return `<a href="${linkUrl}" target="_blank" rel="noopener noreferrer">${img}</a>`;
}

function filteredItems(items) {
  const category = String(categoryFilterEl?.value || "all");
  const minTotalProfit = Number(minProfitFilterEl?.value || 0);
  return items.filter((item) => {
    const hasSheetLink = Boolean(item?.market?.sheetProductUrl);
    const itemCategory = getGameCategory(item.productName);
    const profit = Number(item.metrics.totalBestProfit || 0);
    const categoryPass = category === "all" || itemCategory === category;
    return hasSheetLink && categoryPass && profit >= minTotalProfit;
  });
}

function filteredLoserItems(items) {
  const category = String(categoryFilterEl?.value || "all");
  return items.filter((item) => {
    const hasSheetLink = Boolean(item?.market?.sheetProductUrl);
    const itemCategory = getGameCategory(item.productName);
    const profit = Number(item.metrics.totalBestProfit || 0);
    const categoryPass = category === "all" || itemCategory === category;
    return hasSheetLink && categoryPass && profit < 0;
  });
}

async function api(url, options = {}) {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || "Request failed");
  return json;
}

function pricingStatusMessage(dashboard) {
  const items = Array.isArray(dashboard?.items) ? dashboard.items : [];
  if (!items.length) {
    return dashboard?.importedAt
      ? `Last import: ${new Date(dashboard.importedAt).toLocaleString()}`
      : "No inventory imported yet.";
  }

  const checked = items.filter((item) => item?.market?.lastCheckedAt).length;
  let latest = null;
  for (const item of items) {
    const ts = item?.market?.lastCheckedAt;
    if (ts && (!latest || ts > latest)) latest = ts;
  }

  if (checked === items.length && latest) {
    return `All prices are up to date. Last completed: ${new Date(latest).toLocaleString()}.`;
  }
  if (checked > 0 && latest) {
    return `Price refresh in progress: ${checked}/${items.length} checked. Last update: ${new Date(latest).toLocaleString()}.`;
  }
  return `Prices have not been refreshed yet (${items.length} items loaded).`;
}

function renderTotals(dashboard) {
  if (!totalsEl) return;
  const t = dashboard.totals;
  const winners = Number(t.profitWinnersOnly ?? 0);
  totalsEl.innerHTML = `
    <div class="cards">
      <div class="card"><div class="card-label">Units</div><div class="card-value">${t.units}</div></div>
      <div class="card"><div class="card-label">Cost basis</div><div class="card-value">${money(t.costBasis)}</div></div>
      <div class="card"><div class="card-label">Market value (estimate)</div><div class="card-value">${money(t.marketValue)}</div></div>
      <div class="card" title="Sum of each line: (TCGplayer market after fees − your cost) × quantity. Negative means underwater lines outweigh winners.">
        <div class="card-label">Est. net profit (all lines)</div><div class="card-value">${money(t.bestProfit)}</div>
      </div>
      <div class="card" title="Sum of line profit only where profit is positive.">
        <div class="card-label">Est. profit (winning lines only)</div><div class="card-value">${money(winners)}</div>
      </div>
    </div>
    <p class="help totals-explainer">Net profit is the sum across every SKU; it can be negative if your estimated losses on some lines are larger than gains on others.</p>
  `;
}

function renderRecommendations(dashboard) {
  if (!recTableBody) return;
  recTableBody.innerHTML = "";
  const bestItems = [...filteredItems(dashboard.items)]
    // "Double money" threshold after fees: profit/unit >= unit cost.
    .filter((item) => Number(item.metrics.bestProfitPerUnit || 0) >= Number(item.unitCost || 0))
    .sort((a, b) => Number(b.metrics.totalBestProfit || -Infinity) - Number(a.metrics.totalBestProfit || -Infinity));
  const grandTotalProfit = bestItems.reduce(
    (acc, item) => acc + Number(item.metrics.totalBestProfit || 0),
    0
  );

  for (const item of bestItems) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${item.productName}</td>
      <td class="thumb-cell">${previewCell(item)}</td>
      <td>${item.quantity}</td>
      <td>${money(item.unitCost)}</td>
      <td>${moneyEstimated(item.metrics.tcgplayerMarketPrice)}</td>
      <td>${sourceCell(item)}</td>
      <td>${item.metrics.bestPlatform}</td>
      <td>${money(item.metrics.bestProfitPerUnit)}</td>
      <td>${money(item.metrics.totalBestProfit)}</td>
    `;
    recTableBody.appendChild(row);
  }
  if (recGrandTotalEl) {
    recGrandTotalEl.textContent = `Grand total projected profit (this list): ${money(grandTotalProfit)}`;
  }
}

function renderTopProfitAnalytics(dashboard) {
  if (!analyticsTableBody) return;
  analyticsTableBody.innerHTML = "";
  const top = [...filteredItems(dashboard.items)]
    .sort((a, b) => Number(b.metrics.totalBestProfit || -Infinity) - Number(a.metrics.totalBestProfit || -Infinity));

  for (const item of top) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${item.productName}</td>
      <td class="thumb-cell">${previewCell(item)}</td>
      <td>${item.quantity}</td>
      <td>${money(item.unitCost)}</td>
      <td>${money(item.metrics.totalCostBasis)}</td>
      <td>${moneyEstimated(item.metrics.tcgplayerMarketPrice)}</td>
      <td>${sourceCell(item)}</td>
      <td>${item.metrics.bestPlatform}</td>
      <td>${money(item.metrics.bestFeePerUnit)}</td>
      <td>${money(item.metrics.totalEstimatedFees)}</td>
      <td>${money(item.metrics.bestNetAfterFeesPerUnit)}</td>
      <td>${money(item.metrics.bestProfitPerUnit)}</td>
      <td>${Number.isFinite(Number(item.metrics.bestMarginPct)) ? `${Number(item.metrics.bestMarginPct).toFixed(1)}%` : "—"}</td>
      <td>${money(item.metrics.totalBestProfit)}</td>
    `;
    analyticsTableBody.appendChild(row);
  }
}

function renderSellThisWeek(dashboard) {
  if (!sellWeekTableBody) return;
  sellWeekTableBody.innerHTML = "";
  const picks = filteredItems(dashboard.items)
    .filter(
      (item) =>
        item.metrics.marketPriceKnown &&
        Number(item.metrics.bestProfitPerUnit || 0) > 0 &&
        Number(item.metrics.bestMarginPct || 0) >= 8
    )
    .sort((a, b) => {
      const aScore = confidenceScore(a);
      const bScore = confidenceScore(b);
      if (bScore !== aScore) return bScore - aScore;
      return Number(b.metrics.totalBestProfit || 0) - Number(a.metrics.totalBestProfit || 0);
    });

  for (const item of picks) {
    const score = confidenceScore(item);
    const breakdown = confidenceBreakdown(item);
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${item.productName}</td>
      <td class="thumb-cell">${previewCell(item)}</td>
      <td>${getGameCategory(item.productName)}</td>
      <td>${item.quantity}</td>
      <td>${item.metrics.bestPlatform}</td>
      <td>${money(item.metrics.bestProfitPerUnit)}</td>
      <td>${money(item.metrics.totalBestProfit)}</td>
      <td><span title="${breakdown}">${score}%</span></td>
      <td>${workflowStatusBadge(item)}</td>
      <td>
        <button class="table-btn subtle" data-action="listed" data-item-id="${item.id}" data-platform="${item.metrics.bestPlatform}">Mark listed</button>
        <button class="table-btn" data-action="sold" data-item-id="${item.id}" data-platform="${item.metrics.bestPlatform}">Mark sold</button>
        <button class="table-btn subtle" data-action="reset" data-item-id="${item.id}">Reset</button>
      </td>
    `;
    sellWeekTableBody.appendChild(row);
  }
}

function renderLosingItems(dashboard) {
  if (!losersTableBody) return;
  losersTableBody.innerHTML = "";
  const losers = filteredLoserItems(dashboard.items).sort(
    (a, b) => Number(a.metrics.totalBestProfit || 0) - Number(b.metrics.totalBestProfit || 0)
  );

  for (const item of losers) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${item.productName}</td>
      <td class="thumb-cell">${previewCell(item)}</td>
      <td>${item.quantity}</td>
      <td>${money(item.unitCost)}</td>
      <td>${moneyEstimated(item.metrics.tcgplayerMarketPrice)}</td>
      <td>${sourceCell(item)}</td>
      <td>${money(item.metrics.bestProfitPerUnit)}</td>
      <td>${Number.isFinite(Number(item.metrics.bestMarginPct)) ? `${Number(item.metrics.bestMarginPct).toFixed(1)}%` : "—"}</td>
      <td>${money(item.metrics.totalBestProfit)}</td>
    `;
    losersTableBody.appendChild(row);
  }
}

function renderDashboard(dashboard) {
  lastDashboard = dashboard;
  renderTotals(dashboard);
  renderRecommendations(dashboard);
  renderTopProfitAnalytics(dashboard);
  renderSellThisWeek(dashboard);
  renderLosingItems(dashboard);
}

function renderOrders(orders) {
  if (!ordersTableBody) return;
  ordersTableBody.innerHTML = "";
  const isLikelyStampShipment = (order) => {
    const s = Number(order.shippingCost || 0);
    if (!Number.isFinite(s)) return false;
    return s >= 1.2 && s <= 1.35;
  };
  const trackingStatusLabel = (order) => {
    if (order.noTrackingNeeded) {
      return order.stampAuto ? "No tracking needed (stamp, auto)" : "No tracking needed (stamp)";
    }
    if (String(order.trackingNumber || "").trim()) return "Tracked";
    if (isLikelyStampShipment(order)) return "Likely stamp (shipping ~1.27)";
    return "Missing tracking";
  };
  for (const order of orders) {
    const row = document.createElement("tr");
    const orderNumber = String(order.orderNumber || "").trim();
    const orderLink = orderNumber
      ? `https://sellerportal.tcgplayer.com/orders/${encodeURIComponent(orderNumber)}`
      : null;
    const orderNumberCell = orderLink
      ? `<a href="${orderLink}" target="_blank" rel="noopener noreferrer">${orderNumber}</a>`
      : "—";
    row.innerHTML = `
      <td>${orderNumberCell}</td>
      <td>${order.buyerName || ""}</td>
      <td>${order.purchaseDate || ""}</td>
      <td>${order.platform || ""}</td>
      <td>${order.status || ""}</td>
      <td>${order.shippingType || ""}</td>
      <td>${money(order.salePrice)}</td>
      <td>${money(order.shippingCost)}</td>
      <td>${money(order.feeAmount)}</td>
      <td>${money(order.orderAmount)}</td>
      <td>${trackingStatusLabel(order)}</td>
      <td>${uspsTrackingCell(order.trackingNumber)}</td>
    `;
    ordersTableBody.appendChild(row);
  }
}

function orderTrackingFilterCategory(order) {
  if (order.noTrackingNeeded) return "stamp";
  if (String(order.trackingNumber || "").trim()) return "tracked";
  return "missing";
}

function initOrderFilterDefaults() {
  if (!ordersDateFrom || !ordersDateTo) return;
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 30);
  ordersDateTo.value = to.toISOString().slice(0, 10);
  ordersDateFrom.value = from.toISOString().slice(0, 10);
}

function scheduleOrdersFilterRerender() {
  clearTimeout(ordersSearchDebounce);
  ordersSearchDebounce = setTimeout(() => applyOrderFiltersAndRender(), 200);
}

function applyOrderFiltersAndRender() {
  if (!ordersTableBody) return;
  let list = Array.isArray(lastOrdersRaw) ? [...lastOrdersRaw] : [];
  const from = String(ordersDateFrom?.value || "").trim();
  const to = String(ordersDateTo?.value || "").trim();
  if (from) list = list.filter((o) => String(o.purchaseDate || "") >= from);
  if (to) list = list.filter((o) => String(o.purchaseDate || "") <= to);
  const st = String(ordersTrackingStatusFilter?.value || "").trim();
  if (st) list = list.filter((o) => orderTrackingFilterCategory(o) === st);
  const q = String(ordersSearchInput?.value || "").trim().toLowerCase();
  if (q) {
    list = list.filter((o) => {
      const blob = [o.orderNumber, o.buyerName, o.trackingNumber, o.status, o.channel, o.platform]
        .map((x) => String(x || "").toLowerCase())
        .join(" ");
      return blob.includes(q);
    });
  }
  if (ordersFilterCountEl) {
    const n = list.length;
    const total = lastOrdersRaw.length;
    ordersFilterCountEl.textContent =
      n === total ? `Showing all ${n} order(s)` : `Showing ${n} of ${total} order(s)`;
  }
  renderOrders(list);
}

async function loadDashboard() {
  const dashboard = (await api("/api/inventory/dashboard")).data;
  renderDashboard(dashboard);
  setStatus(pricingStatusMessage(dashboard));
}

async function refreshPricesAndDashboard() {
  let n = 0;
  try {
    const dash = (await api("/api/inventory/dashboard")).data;
    n = Array.isArray(dash.items) ? dash.items.length : 0;
  } catch {
    // ignore; still attempt refresh
  }
  setStatus(
    n > 0
      ? `Refreshing market prices (${n} items — this often takes several minutes; keep this tab open)...`
      : "Refreshing market prices (this can take several minutes; keep this tab open)..."
  );
  let progressTimer = null;
  const startProgressPolling = () => {
    progressTimer = setInterval(async () => {
      try {
        const dash = (await api("/api/inventory/dashboard")).data;
        const items = Array.isArray(dash.items) ? dash.items : [];
        if (!items.length) return;
        const checked = items.filter((item) => item?.market?.lastCheckedAt).length;
        const pct = Math.min(100, Math.round((checked / items.length) * 100));
        setStatus(
          `Refreshing market prices: ${pct}% done (${checked}/${items.length} checked)...`
        );
      } catch {
        // Keep previous status text if polling fails transiently.
      }
    }, 2500);
  };
  const stopProgressPolling = () => {
    if (progressTimer) clearInterval(progressTimer);
    progressTimer = null;
  };

  startProgressPolling();
  try {
    await api("/api/inventory/refresh-prices", {
      method: "POST",
      body: JSON.stringify({}),
    });
  } finally {
    stopProgressPolling();
  }
  if (page === "analytics") {
    await loadDashboard();
  } else {
    const dashboard = (await api("/api/inventory/dashboard")).data;
    setStatus(pricingStatusMessage(dashboard));
  }
}

async function loadOrders() {
  const result = await api("/api/orders");
  lastOrdersRaw = Array.isArray(result.orders) ? result.orders : [];
  applyOrderFiltersAndRender();
}

function renderGmailStatus(status) {
  if (!gmailSyncStatusEl) return;
  if (!status?.connected) {
    gmailSyncStatusEl.textContent = "Gmail is not connected.";
    return;
  }
  const last = status.lastSyncAt
    ? new Date(status.lastSyncAt).toLocaleString()
    : "never";
  const summary = status.lastSyncSummary;
  const summaryText = summary
    ? ` Last sync: scanned ${summary.scannedMessages}, merged ${summary.mergedRecords}, inserted ${summary.inserted}, updated ${summary.updated}.`
    : "";
  const floor = status.earliestAfter
    ? ` Search includes mail on or after ${status.earliestAfter} (Gmail “after” date).`
    : " No calendar floor on Gmail search (set GMAIL_SYNC_AFTER to add one).";
  gmailSyncStatusEl.textContent = `Gmail connected.${floor} Last sync time: ${last}.${summaryText}`;
}

async function loadGmailStatus() {
  if (!gmailSyncStatusEl) return;
  try {
    const result = await api("/api/orders/gmail/status");
    renderGmailStatus(result.status || {});
  } catch (error) {
    gmailSyncStatusEl.textContent = `Gmail status unavailable: ${error.message}`;
  }
}


importBtn?.addEventListener("click", async () => {
  try {
    setStatus("Importing inventory...");
    await api("/api/inventory/import", {
      method: "POST",
      body: JSON.stringify({ filePath: filePathEl.value.trim() }),
    });
    await refreshPricesAndDashboard();
  } catch (error) {
    setStatus(`Import failed: ${error.message}`);
  }
});

scanBtn?.addEventListener("click", async () => {
  try {
    await refreshPricesAndDashboard();
  } catch (error) {
    setStatus(`Price refresh failed: ${error.message}`);
  }
});

reloadBtn?.addEventListener("click", async () => {
  try {
    const dashboard = (await api("/api/inventory/dashboard")).data;
    setStatus(pricingStatusMessage(dashboard));
  } catch (error) {
    setStatus(`Reload failed: ${error.message}`);
  }
});

resetInventoryBtn?.addEventListener("click", async () => {
  const ok = window.confirm(
    "Reset inventory and workflow? This clears imported rows and sell-status tracking."
  );
  if (!ok) return;
  try {
    setStatus("Resetting inventory and workflow...");
    const result = await api("/api/reset/inventory-workflow", {
      method: "POST",
      body: JSON.stringify({}),
    });
    const cleared = Number(result?.result?.clearedInventoryItems || 0);
    setStatus(`Inventory reset complete. Cleared ${cleared} rows.`);
  } catch (error) {
    setStatus(`Inventory reset failed: ${error.message}`);
  }
});

resetOrdersBtn?.addEventListener("click", async () => {
  const ok = window.confirm("Reset all order history?");
  if (!ok) return;
  try {
    setStatus("Resetting orders...");
    const result = await api("/api/reset/orders", {
      method: "POST",
      body: JSON.stringify({}),
    });
    const cleared = Number(result?.result?.clearedOrders || 0);
    setStatus(`Orders reset complete. Cleared ${cleared} orders.`);
  } catch (error) {
    setStatus(`Order reset failed: ${error.message}`);
  }
});

categoryFilterEl?.addEventListener("change", () => {
  if (!lastDashboard) return;
  renderDashboard(lastDashboard);
});

minProfitFilterEl?.addEventListener("input", () => {
  if (!lastDashboard) return;
  renderDashboard(lastDashboard);
});

sellWeekTableBody?.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  const itemId = button.dataset.itemId;
  const platform = button.dataset.platform || null;
  if (!itemId || !action) return;

  try {
    if (action === "sold") {
      const qtyInput = window.prompt("How many units sold?", "1");
      if (qtyInput === null) return;
      const qty = Number(qtyInput);
      if (!Number.isFinite(qty) || qty <= 0) {
        setStatus("Sold action cancelled: quantity must be at least 1.");
        return;
      }
      await api("/api/inventory/workflow", {
        method: "POST",
        body: JSON.stringify({ itemId, action, platform, quantitySold: qty }),
      });
    } else {
      await api("/api/inventory/workflow", {
        method: "POST",
        body: JSON.stringify({ itemId, action, platform }),
      });
    }
    await loadDashboard();
    setStatus(`Item workflow updated: ${action}.`);
  } catch (error) {
    setStatus(`Workflow update failed: ${error.message}`);
  }
});

orderForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(orderForm);
  const payload = Object.fromEntries(fd.entries());
  payload.quantity = Number(payload.quantity || 1);
  payload.salePrice = Number(payload.salePrice || 0);
  payload.feeAmount = Number(payload.feeAmount || 0);
  const rawTax = String(payload.buyerTax ?? "").trim();
  if (rawTax !== "") payload.buyerTax = Number(rawTax);
  else delete payload.buyerTax;
  payload.shippingCost = Number(payload.shippingCost || 0);
  try {
    await api("/api/orders", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    orderForm.reset();
    orderForm.purchaseDate.value = new Date().toISOString().slice(0, 10);
    await loadOrders();
    setStatus("Order recorded.");
  } catch (error) {
    setStatus(`Order save failed: ${error.message}`);
  }
});

importOrdersCsvBtn?.addEventListener("click", async () => {
  try {
    const filePath = String(ordersCsvPathEl?.value || "").trim();
    if (!filePath) {
      setStatus("Provide an orders CSV file path first.");
      return;
    }
    setStatus("Importing orders CSV...");
    const result = await api("/api/orders/import-csv", {
      method: "POST",
      body: JSON.stringify({ filePath, replaceExisting: false }),
    });
    await loadOrders();
    setStatus(`Orders CSV imported: ${result.result.imported} rows added.`);
  } catch (error) {
    setStatus(`Orders CSV import failed: ${error.message}`);
  }
});

replaceOrdersCsvBtn?.addEventListener("click", async () => {
  const ok = window.confirm("Replace all existing orders with this CSV?");
  if (!ok) return;
  try {
    const filePath = String(ordersCsvPathEl?.value || "").trim();
    if (!filePath) {
      setStatus("Provide an orders CSV file path first.");
      return;
    }
    setStatus("Replacing orders with CSV...");
    const result = await api("/api/orders/import-csv", {
      method: "POST",
      body: JSON.stringify({ filePath, replaceExisting: true }),
    });
    await loadOrders();
    setStatus(`Orders replaced from CSV: ${result.result.imported} rows loaded.`);
  } catch (error) {
    setStatus(`Orders replace failed: ${error.message}`);
  }
});

connectGmailBtn?.addEventListener("click", async () => {
  try {
    const result = await api("/api/orders/gmail/auth/start");
    window.location.href = result.authUrl;
  } catch (error) {
    setStatus(`Gmail connect failed: ${error.message}`);
  }
});

disconnectGmailBtn?.addEventListener("click", async () => {
  try {
    await api("/api/orders/gmail/disconnect", {
      method: "POST",
      body: JSON.stringify({}),
    });
    await loadGmailStatus();
    setStatus("Gmail disconnected.");
  } catch (error) {
    setStatus(`Gmail disconnect failed: ${error.message}`);
  }
});

async function runGmailSync({ fullRescan, label }) {
  setStatus(label);
  const result = await api("/api/orders/gmail/sync", {
    method: "POST",
    body: JSON.stringify({
      maxPerQuery: 100,
      maxPages: fullRescan ? 20 : 12,
      dryRun: false,
      fullRescan,
    }),
  });
  await loadOrders();
  await loadGmailStatus();
  setStatus(
    `Gmail sync complete: ${result.result.mergedRecords} merged (${result.result.inserted} inserted, ${result.result.updated} updated).`
  );
}

syncGmailBtn?.addEventListener("click", async () => {
  try {
    await runGmailSync({ fullRescan: false, label: "Syncing orders from Gmail…" });
  } catch (error) {
    setStatus(`Gmail sync failed: ${error.message}`);
  }
});

syncGmailFullBtn?.addEventListener("click", async () => {
  try {
    await runGmailSync({ fullRescan: true, label: "Syncing Gmail (full YTD pass, may take a bit)…" });
  } catch (error) {
    setStatus(`Gmail sync failed: ${error.message}`);
  }
});


if (filePathEl) filePathEl.value = "C:\\Users\\TheIv\\Downloads\\PreEminent Inventory.xlsx";
if (ordersCsvPathEl) {
  ordersCsvPathEl.value = "C:\\Users\\TheIv\\Downloads\\TCGplayer_OrderList_20260430_074335.csv";
}
if (orderForm) orderForm.purchaseDate.value = new Date().toISOString().slice(0, 10);

if (page === "import") {
  refreshPricesAndDashboard().catch((e) => setStatus(`Load failed: ${e.message}`));
} else if (page === "analytics") {
  loadDashboard().catch((e) => setStatus(`Dashboard load failed: ${e.message}`));
} else if (page === "orders") {
  initOrderFilterDefaults();
  ordersSearchInput?.addEventListener("input", scheduleOrdersFilterRerender);
  ordersTrackingStatusFilter?.addEventListener("change", applyOrderFiltersAndRender);
  ordersDateFrom?.addEventListener("change", applyOrderFiltersAndRender);
  ordersDateTo?.addEventListener("change", applyOrderFiltersAndRender);
  Promise.all([loadOrders(), loadGmailStatus()]).catch((e) =>
    setStatus(`Order load failed: ${e.message}`)
  );
}
