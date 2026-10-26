(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const money = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return "—";
    const abs = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return n < 0 ? `-$${abs}` : `$${abs}`;
  };

  let report = null;
  let expenseCategories = ["subscription", "marketplace_fees", "office_supplies", "shipping", "software", "insurance", "other"];

  const categoryLabels = {
    subscription: "Subscription",
    marketplace_fees: "Marketplace / seller fees",
    office_supplies: "Office supplies",
    shipping: "Shipping / postage",
    software: "Software",
    insurance: "Insurance",
    other: "Other",
  };

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
    const el = $("taxPrepStatus");
    if (el) el.textContent = text;
  }

  function selectedYear() {
    return Number($("taxYearSelect")?.value) || new Date().getFullYear();
  }

  function newId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  }

  function lineTotal(qty, unitCost) {
    const q = Number(qty);
    const u = Number(unitCost);
    if (!Number.isFinite(q) || !Number.isFinite(u)) return 0;
    return Math.round(q * u * 100) / 100;
  }

  function escapeCsv(v) {
    const s = String(v ?? "");
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }

  function downloadCsv(filename, rows) {
    const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function readInventoryRows(tbody) {
    const rows = [];
    tbody.querySelectorAll("tr[data-row-id]").forEach((tr) => {
      const qty = Number(tr.querySelector('[data-field="qty"]')?.value || 0);
      const unitCost = Number(tr.querySelector('[data-field="unitCost"]')?.value || 0);
      rows.push({
        id: tr.dataset.rowId,
        description: tr.querySelector('[data-field="description"]')?.value?.trim() || "",
        qty,
        unitCost,
        totalCost: lineTotal(qty, unitCost),
        notes: tr.querySelector('[data-field="notes"]')?.value?.trim() || "",
        source: tr.dataset.source || "manual",
      });
    });
    return rows;
  }

  function readExpenseRows(tbody) {
    const rows = [];
    tbody.querySelectorAll("tr[data-row-id]").forEach((tr) => {
      rows.push({
        id: tr.dataset.rowId,
        date: tr.querySelector('[data-field="date"]')?.value || "",
        category: tr.querySelector('[data-field="category"]')?.value || "other",
        vendor: tr.querySelector('[data-field="vendor"]')?.value?.trim() || "",
        description: tr.querySelector('[data-field="description"]')?.value?.trim() || "",
        amount: Number(tr.querySelector('[data-field="amount"]')?.value || 0),
        notes: tr.querySelector('[data-field="notes"]')?.value?.trim() || "",
      });
    });
    return rows;
  }

  function bindInventoryRowCalc(tr) {
    const recalc = () => {
      const qty = Number(tr.querySelector('[data-field="qty"]')?.value || 0);
      const unit = Number(tr.querySelector('[data-field="unitCost"]')?.value || 0);
      const cell = tr.querySelector('[data-field="totalCost"]');
      if (cell) cell.textContent = money(lineTotal(qty, unit));
    };
    tr.querySelectorAll('[data-field="qty"], [data-field="unitCost"]').forEach((el) => {
      el.addEventListener("input", recalc);
    });
  }

  function inventoryRowHtml(row) {
    const id = row.id || newId("inv");
    const total = row.totalCost ?? lineTotal(row.qty, row.unitCost);
    return `
      <tr data-row-id="${id}" data-source="${row.source || "manual"}">
        <td><input type="text" data-field="description" value="${String(row.description || "").replace(/"/g, "&quot;")}" /></td>
        <td><input type="number" data-field="qty" min="0" step="1" value="${Number(row.qty || 0)}" class="num-input" /></td>
        <td><input type="number" data-field="unitCost" min="0" step="0.01" value="${Number(row.unitCost || 0).toFixed(2)}" class="num-input" /></td>
        <td class="num" data-field="totalCost">${money(total)}</td>
        <td><input type="text" data-field="notes" value="${String(row.notes || "").replace(/"/g, "&quot;")}" /></td>
        <td><button type="button" class="subtle tax-del-row-btn">Remove</button></td>
      </tr>`;
  }

  function expenseRowHtml(row) {
    const id = row.id || newId("exp");
    const opts = expenseCategories
      .map((c) => `<option value="${c}" ${row.category === c ? "selected" : ""}>${categoryLabels[c] || c}</option>`)
      .join("");
    return `
      <tr data-row-id="${id}">
        <td><input type="date" data-field="date" value="${String(row.date || "").slice(0, 10)}" /></td>
        <td><select data-field="category">${opts}</select></td>
        <td><input type="text" data-field="vendor" value="${String(row.vendor || "").replace(/"/g, "&quot;")}" /></td>
        <td><input type="text" data-field="description" value="${String(row.description || "").replace(/"/g, "&quot;")}" /></td>
        <td><input type="number" data-field="amount" min="0" step="0.01" value="${Number(row.amount || 0).toFixed(2)}" class="num-input" /></td>
        <td><input type="text" data-field="notes" value="${String(row.notes || "").replace(/"/g, "&quot;")}" /></td>
        <td><button type="button" class="subtle tax-del-row-btn">Remove</button></td>
      </tr>`;
  }

  function renderInventoryTable(tableId, rows, totalId) {
    const tbody = document.querySelector(`#${tableId} tbody`);
    if (!tbody) return;
    tbody.innerHTML = rows.map((r) => inventoryRowHtml(r)).join("");
    tbody.querySelectorAll("tr").forEach(bindInventoryRowCalc);
    const total = rows.reduce((a, r) => a + Number(r.totalCost ?? lineTotal(r.qty, r.unitCost)), 0);
    const foot = $(totalId);
    if (foot) foot.textContent = money(total);
  }

  function renderSalesTable(rows) {
    const tbody = document.querySelector("#tableSales tbody");
    if (!tbody) return;
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="12" class="empty-cell">No sales in Order Tracking for this year yet.</td></tr>`;
    } else {
      tbody.innerHTML = rows
        .map(
          (r) => `
        <tr>
          <td>${r.saleDate || "—"}</td>
          <td>${r.orderNumber || "—"}</td>
          <td>${r.description || "—"}</td>
          <td>${r.buyerName || "—"}</td>
          <td>${r.platform || "—"}</td>
          <td class="num">${r.qty ?? 1}</td>
          <td class="num">${money(r.salePrice)}</td>
          <td class="num">${money(r.feesPaid)}</td>
          <td class="num">${money(r.shippingCost)}</td>
          <td class="num">${money(r.grossReceipts)}</td>
          <td class="num">${money(r.netProceeds)}</td>
          <td>${r.status || "—"}</td>
        </tr>`
        )
        .join("");
    }
    const t = report?.totals || {};
    if ($("totalSalesSale")) $("totalSalesSale").textContent = money(rows.reduce((a, r) => a + Number(r.salePrice || 0), 0));
    if ($("totalSalesFees")) $("totalSalesFees").textContent = money(t.salesFees);
    if ($("totalSalesShip")) $("totalSalesShip").textContent = money(t.salesShipping);
    if ($("totalSalesGross")) $("totalSalesGross").textContent = money(t.salesGross);
    if ($("totalSalesNet")) $("totalSalesNet").textContent = money(t.salesNet);
  }

  function renderExpensesTable(rows) {
    const tbody = document.querySelector("#tableExpenses tbody");
    if (!tbody) return;
    tbody.innerHTML = rows.length ? rows.map((r) => expenseRowHtml(r)).join("") : "";
    const total = rows.reduce((a, r) => a + Number(r.amount || 0), 0);
    if ($("totalExpenses")) $("totalExpenses").textContent = money(total);
  }

  function renderSummary() {
    const kpi = $("taxSummaryKpis");
    const t = report?.totals || {};
    if (!kpi) return;
    kpi.innerHTML = `
      <div class="card"><div class="card-label">Beginning inventory</div><div class="card-value">${money(t.priorInventoryCost)}</div></div>
      <div class="card"><div class="card-label">Purchases</div><div class="card-value">${money(t.purchasesCost)}</div></div>
      <div class="card"><div class="card-label">Ending inventory</div><div class="card-value">${money(t.endingInventoryCost)}</div></div>
      <div class="card"><div class="card-label">Est. COGS</div><div class="card-value">${money(t.estimatedCogs)}</div></div>
      <div class="card"><div class="card-label">Gross sales</div><div class="card-value">${money(t.salesGross)}</div></div>
      <div class="card"><div class="card-label">Marketplace fees</div><div class="card-value">${money(t.salesFees)}</div></div>
      <div class="card"><div class="card-label">Business expenses</div><div class="card-value">${money(t.expensesTotal)}</div></div>
    `;
    const note = $("taxCogsNote");
    if (note) {
      note.textContent =
        `Estimated COGS = beginning inventory + purchases − ending inventory (${money(t.priorInventoryCost)} + ${money(t.purchasesCost)} − ${money(t.endingInventoryCost)}). ` +
        "Confirm with your tax preparer; this is a workbook, not tax advice.";
    }
  }

  function renderAll() {
    if (!report) return;
    renderInventoryTable("tablePriorInventory", report.priorInventory || [], "totalPriorInventory");
    renderInventoryTable("tablePurchases", report.purchases || [], "totalPurchases");
    renderSalesTable(report.sales || []);
    renderInventoryTable("tableEndingInventory", report.endingInventory || [], "totalEndingInventory");
    renderExpensesTable(report.expenses || []);
    renderSummary();
  }

  async function loadReport() {
    setStatus("Loading…");
    const year = selectedYear();
    const result = await api(`/api/tax-prep?year=${year}`);
    report = result.data;
    if (Array.isArray(report.expenseCategories)) expenseCategories = report.expenseCategories;
    renderAll();
    setStatus(
      `Tax prep workbook for ${year} — ${report.sales?.length || 0} sale(s)` +
        (report.salesSource === "year_sheet" ? " from sold sheets" : " from Order Tracking") +
        `, last updated ${new Date(report.generatedAt).toLocaleString()}.`
    );
  }

  function sectionRows(section) {
    if (section === "priorInventory") return readInventoryRows(document.querySelector("#tablePriorInventory tbody"));
    if (section === "purchases") return readInventoryRows(document.querySelector("#tablePurchases tbody"));
    if (section === "endingInventory") return readInventoryRows(document.querySelector("#tableEndingInventory tbody"));
    if (section === "expenses") return readExpenseRows(document.querySelector("#tableExpenses tbody"));
    return [];
  }

  async function saveSection(section) {
    const year = selectedYear();
    const rows = sectionRows(section);
    setStatus(`Saving ${section}…`);
    const result = await api(`/api/tax-prep/${section}`, {
      method: "PUT",
      body: JSON.stringify({ year, rows }),
    });
    report = result.data;
    renderAll();
    setStatus(`Saved ${section} for ${year}.`);
  }

  function exportInventoryCsv(title, rows) {
    const header = ["Description", "Qty", "Unit cost", "Total cost", "Notes", "Source"];
    const lines = [
      header.join(","),
      ...rows.map((r) =>
        [r.description, r.qty, r.unitCost, r.totalCost, r.notes, r.source].map(escapeCsv).join(",")
      ),
    ];
    downloadCsv(`${title}_${selectedYear()}.csv`, lines);
  }

  function exportSalesCsv(rows) {
    const header = [
      "Date",
      "Order #",
      "Description",
      "Buyer",
      "Platform",
      "Qty",
      "Sale",
      "Fees paid",
      "Shipping",
      "Gross",
      "Net proceeds",
      "Status",
    ];
    const lines = [
      header.join(","),
      ...rows.map((r) =>
        [
          r.saleDate,
          r.orderNumber,
          r.description,
          r.buyerName,
          r.platform,
          r.qty,
          r.salePrice,
          r.feesPaid,
          r.shippingCost,
          r.grossReceipts,
          r.netProceeds,
          r.status,
        ]
          .map(escapeCsv)
          .join(",")
      ),
    ];
    downloadCsv(`sales_${selectedYear()}.csv`, lines);
  }

  function exportExpensesCsv(rows) {
    const header = ["Date", "Category", "Vendor", "Description", "Amount", "Notes"];
    const lines = [
      header.join(","),
      ...rows.map((r) =>
        [r.date, r.category, r.vendor, r.description, r.amount, r.notes].map(escapeCsv).join(",")
      ),
    ];
    downloadCsv(`expenses_${selectedYear()}.csv`, lines);
  }

  function exportSection(section) {
    if (!report) return;
    if (section === "priorInventory") exportInventoryCsv("beginning_inventory", sectionRows("priorInventory"));
    else if (section === "purchases") exportInventoryCsv("purchases", sectionRows("purchases"));
    else if (section === "endingInventory") exportInventoryCsv("ending_inventory", sectionRows("endingInventory"));
    else if (section === "sales") exportSalesCsv(report.sales || []);
    else if (section === "expenses") exportExpensesCsv(sectionRows("expenses"));
  }

  function exportAll() {
    exportSection("priorInventory");
    exportSection("purchases");
    exportSection("sales");
    exportSection("endingInventory");
    exportSection("expenses");
    setStatus(`Exported all sections for ${selectedYear()} (five CSV files).`);
  }

  function initYearSelect() {
    const sel = $("taxYearSelect");
    if (!sel) return;
    const now = new Date().getFullYear();
    sel.innerHTML = "";
    for (let y = now; y >= now - 5; y--) {
      const opt = document.createElement("option");
      opt.value = String(y);
      opt.textContent = String(y);
      sel.appendChild(opt);
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    initYearSelect();
    $("taxYearSelect")?.addEventListener("change", () => loadReport().catch((e) => setStatus(e.message)));
    $("taxReloadBtn")?.addEventListener("click", () => loadReport().catch((e) => setStatus(e.message)));

    document.querySelectorAll(".tax-save-section-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const section = btn.closest(".tax-section")?.dataset.section;
        if (section) saveSection(section).catch((e) => setStatus(e.message));
      });
    });

    document.querySelectorAll(".tax-export-section-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const section = btn.closest(".tax-section")?.dataset.section;
        if (section) exportSection(section);
      });
    });

    $("taxExportAllBtn")?.addEventListener("click", exportAll);

    document.querySelectorAll(".tax-snapshot-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const target = btn.dataset.target || "ending";
        const year = selectedYear();
        if (
          !window.confirm(
            target === "prior"
              ? `Replace beginning inventory for ${year} with a snapshot of today's import?`
              : `Replace ending inventory for ${year} with a snapshot of today's import?`
          )
        ) {
          return;
        }
        setStatus("Snapshotting inventory…");
        const result = await api("/api/tax-prep/snapshot-inventory", {
          method: "POST",
          body: JSON.stringify({ year, target }),
        });
        report = result.data;
        renderAll();
        setStatus(`Inventory snapshot saved for ${year} (${target}).`);
      });
    });

    document.querySelectorAll(".tax-add-row-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const section = btn.closest(".tax-section")?.dataset.section;
        const tableMap = {
          priorInventory: "tablePriorInventory",
          purchases: "tablePurchases",
          endingInventory: "tableEndingInventory",
        };
        const tableId = tableMap[section];
        const tbody = document.querySelector(`#${tableId} tbody`);
        if (!tbody) return;
        tbody.insertAdjacentHTML("beforeend", inventoryRowHtml({ id: newId("inv"), qty: 1, unitCost: 0 }));
        const tr = tbody.lastElementChild;
        bindInventoryRowCalc(tr);
      });
    });

    document
      .querySelector(".tax-section[data-section='expenses']")
      ?.querySelector(".tax-add-expense-btn")
      ?.addEventListener("click", () => {
        const tbody = document.querySelector("#tableExpenses tbody");
        if (!tbody) return;
        tbody.insertAdjacentHTML(
          "beforeend",
          expenseRowHtml({ id: newId("exp"), date: new Date().toISOString().slice(0, 10), amount: 0 })
        );
      });

    document.body.addEventListener("click", (e) => {
      if (!e.target.classList.contains("tax-del-row-btn")) return;
      e.target.closest("tr")?.remove();
    });

    loadReport().catch((e) => setStatus(e.message));
  });
})();
