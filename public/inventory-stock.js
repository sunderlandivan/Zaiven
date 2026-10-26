(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const money = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return "—";
    const abs = Math.abs(n).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return n < 0 ? `-$${abs}` : `$${abs}`;
  };

  const pct = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return "—";
    return `${n.toFixed(1)}%`;
  };

  let stockData = null;
  let matchOptions = [];
  let sortKey = "productName";
  let sortDir = "asc";

  const SORT_NUMERIC = new Set([
    "qtyExcel",
    "soldSinceImport",
    "available",
    "unitCost",
    "totalInv",
    "lastRetail",
    "totalRetail",
    "feePerUnit",
    "profitPerUnit",
    "profitTotal",
    "marginPct",
  ]);

  async function api(url, options = {}) {
    const res = await fetch(url, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || "Request failed");
    return json;
  }

  function setStatus(text) {
    const el = $("stockStatus");
    if (el) el.textContent = text;
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderKpis() {
    const s = stockData?.summary || {};
    const kpi = $("stockKpis");
    if (!kpi) return;
    kpi.innerHTML = `
      <div class="card"><div class="card-label">Grand Total Inv $</div><div class="card-value">${money(s.grandTotalInv)}</div></div>
      <div class="card"><div class="card-label">Retail Total</div><div class="card-value">${money(s.retailTotal)}</div></div>
      <div class="card"><div class="card-label">Est. profit (available)</div><div class="card-value">${money(s.estProfit)}</div></div>
      <div class="card"><div class="card-label">Units available</div><div class="card-value">${s.unitsAvailable ?? 0}</div></div>
      <div class="card"><div class="card-label">Sold since import</div><div class="card-value">${s.unitsSoldSinceImport ?? 0}</div></div>
      <div class="card"><div class="card-label">Needs match</div><div class="card-value">${s.unmatchedSales ?? 0}</div></div>
    `;
    const note = $("stockImportNote");
    if (note) {
      note.textContent = s.importedAt
        ? `Last Excel import: ${new Date(s.importedAt).toLocaleString()}. Sold-since-import only counts sales on/after that time.`
        : "No Excel import yet — import inventory first.";
    }
  }

  function filteredItems() {
    const q = String($("stockSearch")?.value || "")
      .trim()
      .toLowerCase();
    const st = String($("stockStatusFilter")?.value || "").trim();
    let list = Array.isArray(stockData?.items) ? [...stockData.items] : [];
    if (st) list = list.filter((r) => r.status === st);
    if (q) {
      list = list.filter((r) =>
        [r.productName, r.itemType, r.status, r.purchaseYear, r.game].join(" ").toLowerCase().includes(q)
      );
    }
    return sortItems(list);
  }

  function sortValue(row, key) {
    const v = row?.[key];
    if (SORT_NUMERIC.has(key)) {
      const n = Number(v);
      return Number.isFinite(n) ? n : Number.NEGATIVE_INFINITY;
    }
    return String(v ?? "").toLowerCase();
  }

  function sortItems(list) {
    const dir = sortDir === "desc" ? -1 : 1;
    const key = sortKey || "productName";
    return list.sort((a, b) => {
      const av = sortValue(a, key);
      const bv = sortValue(b, key);
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      const an = String(a.productName || "").toLowerCase();
      const bn = String(b.productName || "").toLowerCase();
      if (an < bn) return -1;
      if (an > bn) return 1;
      return 0;
    });
  }

  function updateSortHeaders() {
    document.querySelectorAll("#stockTable .th-sort").forEach((btn) => {
      const key = btn.dataset.sort;
      btn.classList.toggle("is-active", key === sortKey);
      btn.dataset.dir = key === sortKey ? sortDir : "";
      const label = btn.textContent.replace(/\s*[▲▼↕]\s*$/, "").trim();
      const mark = key !== sortKey ? " ↕" : sortDir === "asc" ? " ▲" : " ▼";
      btn.textContent = `${label}${mark}`;
    });
  }

  function renderStockTable() {
    const tbody = document.querySelector("#stockTable tbody");
    if (!tbody) return;
    updateSortHeaders();
    const rows = filteredItems();
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="17" class="empty-cell">No inventory rows. Import Excel on Import and Pricing.</td></tr>`;
      return;
    }
    tbody.innerHTML = rows
      .map((r) => {
        const link = r.tcgLink
          ? `<a href="${escapeHtml(r.tcgLink)}" target="_blank" rel="noopener">Open</a>`
          : "—";
        const statusClass =
          r.status === "Sold out" || r.status === "Sold since import"
            ? "stock-status-out"
            : r.status === "Listed"
              ? "stock-status-listed"
              : "stock-status-ok";
        return `<tr>
          <td>${escapeHtml(r.productName)}</td>
          <td>${escapeHtml(r.itemType || "—")}</td>
          <td>${escapeHtml(r.purchaseYear || "—")}</td>
          <td>${escapeHtml(r.game || "—")}</td>
          <td class="num">${r.qtyExcel}</td>
          <td class="num">${r.soldSinceImport}</td>
          <td class="num"><strong>${r.available}</strong></td>
          <td class="num">${money(r.unitCost)}</td>
          <td class="num">${money(r.totalInv)}</td>
          <td class="num">${money(r.lastRetail)}</td>
          <td class="num">${money(r.totalRetail)}</td>
          <td class="num">${money(r.feePerUnit)}</td>
          <td class="num">${money(r.profitPerUnit)}</td>
          <td class="num">${money(r.profitTotal)}</td>
          <td class="num">${pct(r.marginPct)}</td>
          <td><span class="stock-status ${statusClass}">${escapeHtml(r.status)}</span></td>
          <td>${link}</td>
        </tr>`;
      })
      .join("");
  }

  function optionHtml(selectedId) {
    const opts = [`<option value="">Select inventory item…</option>`];
    for (const it of matchOptions) {
      const sel = String(it.id) === String(selectedId) ? "selected" : "";
      opts.push(
        `<option value="${escapeHtml(it.id)}" ${sel}>${escapeHtml(it.productName)} (qty ${it.quantity})</option>`
      );
    }
    return opts.join("");
  }

  function renderNeedsMatch() {
    const unmatched = Array.isArray(stockData?.unmatched) ? stockData.unmatched : [];
    const tbody = document.querySelector("#needsMatchTable tbody");
    const empty = $("needsMatchEmpty");
    if (!tbody) return;
    if (!unmatched.length) {
      tbody.innerHTML = "";
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;
    tbody.innerHTML = unmatched
      .map(
        (row) => `<tr data-order="${escapeHtml(row.orderNumber)}" data-line="${row.lineIndex}">
          <td>${escapeHtml(row.saleDate || "—")}</td>
          <td>${escapeHtml(row.orderNumber)}</td>
          <td>${escapeHtml(row.description)}</td>
          <td class="num">${row.quantity}</td>
          <td><select class="match-item-select">${optionHtml("")}</select></td>
          <td class="row">
            <button type="button" class="confirm-match-btn">Confirm</button>
            <button type="button" class="subtle ignore-match-btn">Ignore</button>
          </td>
        </tr>`
      )
      .join("");
  }

  async function loadAll() {
    setStatus("Loading inventory…");
    const [stock, matches] = await Promise.all([
      api("/api/inventory/stock"),
      api("/api/inventory/sales-matches"),
    ]);
    stockData = stock.data;
    matchOptions = Array.isArray(matches.data?.itemOptions) ? matches.data.itemOptions : [];
    if (Array.isArray(matches.data?.unmatched)) {
      stockData.unmatched = matches.data.unmatched;
    }
    renderKpis();
    renderNeedsMatch();
    renderStockTable();
    setStatus(
      `Loaded ${stockData.items?.length || 0} SKUs · ${stockData.summary?.unmatchedSales || 0} need match.`
    );
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("stockReloadBtn")?.addEventListener("click", () => loadAll().catch((e) => setStatus(e.message)));
    $("stockSearch")?.addEventListener("input", () => renderStockTable());
    $("stockStatusFilter")?.addEventListener("change", () => renderStockTable());

    document.querySelector("#stockTable thead")?.addEventListener("click", (e) => {
      const btn = e.target.closest(".th-sort");
      if (!btn) return;
      const key = btn.dataset.sort;
      if (!key) return;
      if (sortKey === key) sortDir = sortDir === "asc" ? "desc" : "asc";
      else {
        sortKey = key;
        sortDir = SORT_NUMERIC.has(key) ? "desc" : "asc";
      }
      renderStockTable();
    });

    $("stockAutoMatchBtn")?.addEventListener("click", async () => {
      try {
        setStatus("Running auto-match…");
        const result = await api("/api/inventory/sales-matches/auto", { method: "POST", body: "{}" });
        stockData = result.data;
        const matches = await api("/api/inventory/sales-matches");
        matchOptions = matches.data?.itemOptions || [];
        stockData.unmatched = matches.data?.unmatched || [];
        renderKpis();
        renderNeedsMatch();
        renderStockTable();
        setStatus(
          `Auto-match: ${result.result?.autoMatched || 0} matched, ${result.result?.needsMatch || 0} still need review.`
        );
      } catch (e) {
        setStatus(e.message);
      }
    });

    document.body.addEventListener("click", async (e) => {
      const confirmBtn = e.target.closest(".confirm-match-btn");
      const ignoreBtn = e.target.closest(".ignore-match-btn");
      if (!confirmBtn && !ignoreBtn) return;
      const tr = e.target.closest("tr[data-order]");
      if (!tr) return;
      const orderNumber = tr.dataset.order;
      const lineIndex = Number(tr.dataset.line);
      try {
        if (ignoreBtn) {
          await api("/api/inventory/sales-matches", {
            method: "POST",
            body: JSON.stringify({ orderNumber, lineIndex, ignore: true }),
          });
        } else {
          const itemId = tr.querySelector(".match-item-select")?.value;
          if (!itemId) {
            setStatus("Select an inventory item first.");
            return;
          }
          await api("/api/inventory/sales-matches", {
            method: "POST",
            body: JSON.stringify({ orderNumber, lineIndex, itemId }),
          });
        }
        await loadAll();
      } catch (err) {
        setStatus(err.message);
      }
    });

    loadAll().catch((e) => setStatus(e.message));
  });
})();
