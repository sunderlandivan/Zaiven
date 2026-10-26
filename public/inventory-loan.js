/**
 * Loan dashboard — repayment progress, charts, and payment history.
 * Requires global Chart from chart.umd.min.js.
 */
(function () {
  "use strict";

  // Chart colors follow the portal theme (light or dark) from inventory.css.
  const css = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  const C = {
    text: css("--text", "#101828"),
    text2: css("--text-2", "#344054"),
    muted: css("--muted", "#475467"),
    line: css("--line", "#e4e7ec"),
    panel: css("--panel", "#ffffff"),
    font: css("--font", "system-ui, sans-serif"),
  };

  const $ = (id) => document.getElementById(id);

  const money = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return "—";
    const abs = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return n < 0 ? `-$${abs}` : `$${abs}`;
  };

  const pct = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return "—";
    return `${n.toFixed(2)}%`;
  };

  let report = null;
  const charts = { split: null, balance: null, month: null };

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
    const el = $("loanStatus");
    if (el) el.textContent = text;
  }

  function destroyChart(key) {
    if (charts[key]) {
      charts[key].destroy();
      charts[key] = null;
    }
  }

  function chartDefaults() {
    if (typeof Chart === "undefined") return;
    Chart.defaults.color = C.muted;
    Chart.defaults.borderColor = C.line;
    Chart.defaults.font.family = C.font;
  }

  function renderKpis() {
    const el = $("loanKpis");
    if (!el || !report) return;
    el.innerHTML = `
      <article class="card loan-kpi loan-kpi--principal">
        <div class="card-label">Total loan amount</div>
        <div class="card-value">${money(report.totalLoanAmount)}</div>
      </article>
      <article class="card loan-kpi loan-kpi--paid">
        <div class="card-label">Total paid</div>
        <div class="card-value">${money(report.totalPaid)}</div>
      </article>
      <article class="card loan-kpi loan-kpi--remaining">
        <div class="card-label">Total remaining</div>
        <div class="card-value">${money(report.remaining)}</div>
      </article>
      <article class="card">
        <div class="card-label">Payoff</div>
        <div class="card-value">${pct(report.payoffPct)}</div>
      </article>
      <article class="card">
        <div class="card-label">Payments</div>
        <div class="card-value">${report.paymentCount}</div>
      </article>
    `;

    const bar = $("loanProgressBar");
    const pctEl = $("loanProgressPct");
    const label = $("loanProgressLabel");
    const p = Math.max(0, Math.min(100, Number(report.payoffPct) || 0));
    if (bar) bar.style.width = `${p}%`;
    if (pctEl) pctEl.textContent = pct(report.payoffPct);
    if (label) {
      label.textContent = `${money(report.totalPaidAbs)} paid of ${money(report.totalLoanAmount)}`;
    }
  }

  function fillMetaForm() {
    if (!report) return;
    $("loanPrincipalInput").value = report.totalLoanAmount ?? "";
    $("loanBankInput").value = report.currentInBank ?? "";
    $("loanPendingInput").value = report.pendingPayment ?? "";
    $("loanNotesInput").value = report.notes || "";
    $("loanIncomingTotal").textContent = money(report.totalIncomingBanked);
  }

  function renderHistory() {
    const tbody = document.querySelector("#loanHistoryTable tbody");
    if (!tbody || !report) return;
    const rows = [...(report.payments || [])].reverse();
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty-cell">No payments yet.</td></tr>`;
      return;
    }
    tbody.innerHTML = rows
      .map(
        (p) => `<tr data-id="${p.id}">
          <td>${p.date}</td>
          <td class="num">${money(p.amount)}</td>
          <td class="num">${money(p.cumulativePaid)}</td>
          <td class="num">${money(p.balanceAfter)}</td>
          <td>${p.note ? String(p.note).replace(/</g, "&lt;") : "—"}</td>
          <td><button type="button" class="subtle loan-delete-btn" data-id="${p.id}">Delete</button></td>
        </tr>`
      )
      .join("");
  }

  function renderCharts() {
    if (typeof Chart === "undefined" || !report) return;
    chartDefaults();

    destroyChart("split");
    const splitCtx = $("chartLoanSplit")?.getContext("2d");
    if (splitCtx) {
      const split = report.charts?.payoffSplit || [];
      charts.split = new Chart(splitCtx, {
        type: "doughnut",
        data: {
          labels: split.map((s) => s.label),
          datasets: [
            {
              data: split.map((s) => s.value),
              backgroundColor: ["#3d9a6a", "#c44b4b"],
              borderWidth: 0,
            },
          ],
        },
        options: {
          plugins: {
            legend: { position: "bottom" },
            tooltip: {
              callbacks: {
                label: (ctx) => `${ctx.label}: ${money(ctx.raw)}`,
              },
            },
          },
        },
      });
    }

    destroyChart("balance");
    const balCtx = $("chartLoanBalance")?.getContext("2d");
    if (balCtx) {
      const series = report.charts?.cumulative || [];
      charts.balance = new Chart(balCtx, {
        type: "line",
        data: {
          labels: series.map((p) => p.date),
          datasets: [
            {
              label: "Remaining",
              data: series.map((p) => p.remaining),
              borderColor: "#c44b4b",
              backgroundColor: "rgba(196, 75, 75, 0.12)",
              fill: true,
              tension: 0.2,
              pointRadius: 2,
            },
            {
              label: "Cumulative paid",
              data: series.map((p) => p.cumulativePaid),
              borderColor: "#3d9a6a",
              backgroundColor: "transparent",
              tension: 0.2,
              pointRadius: 2,
            },
          ],
        },
        options: {
          interaction: { mode: "index", intersect: false },
          scales: {
            y: {
              ticks: {
                callback: (v) =>
                  `$${Number(v).toLocaleString("en-US", { maximumFractionDigits: 0 })}`,
              },
            },
          },
          plugins: {
            tooltip: {
              callbacks: {
                label: (ctx) => `${ctx.dataset.label}: ${money(ctx.raw)}`,
              },
            },
          },
        },
      });
    }

    destroyChart("month");
    const monthCtx = $("chartLoanByMonth")?.getContext("2d");
    if (monthCtx) {
      const months = report.charts?.byMonth || [];
      charts.month = new Chart(monthCtx, {
        type: "bar",
        data: {
          labels: months.map((m) => m.month),
          datasets: [
            {
              label: "Paid",
              data: months.map((m) => m.paid),
              backgroundColor: css("--chart-1", "#4f46e5"),
            },
          ],
        },
        options: {
          scales: {
            y: {
              beginAtZero: true,
              ticks: {
                callback: (v) =>
                  `$${Number(v).toLocaleString("en-US", { maximumFractionDigits: 0 })}`,
              },
            },
          },
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: (ctx) => money(ctx.raw),
              },
            },
          },
        },
      });
    }
  }

  function renderAll() {
    renderKpis();
    fillMetaForm();
    renderHistory();
    renderCharts();
  }

  async function loadReport() {
    setStatus("Loading loan…");
    const result = await api("/api/loan");
    report = result.data;
    renderAll();
    setStatus(
      `Loan updated ${report.updatedAt ? new Date(report.updatedAt).toLocaleString() : "—"} · ${report.paymentCount} payment(s) · ${pct(report.payoffPct)} paid off`
    );
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("loanReloadBtn")?.addEventListener("click", () => loadReport().catch((e) => setStatus(e.message)));

    $("loanSaveMetaBtn")?.addEventListener("click", async () => {
      try {
        setStatus("Saving…");
        const bankRaw = $("loanBankInput").value;
        const pendingRaw = $("loanPendingInput").value;
        const result = await api("/api/loan", {
          method: "PUT",
          body: JSON.stringify({
            totalLoanAmount: $("loanPrincipalInput").value,
            currentInBank: bankRaw === "" ? null : bankRaw,
            pendingPayment: pendingRaw === "" ? null : pendingRaw,
            notes: $("loanNotesInput").value,
          }),
        });
        report = result.data;
        renderAll();
        setStatus("Loan details saved.");
      } catch (e) {
        setStatus(e.message);
      }
    });

    $("loanAddForm")?.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      try {
        setStatus("Adding payment…");
        const result = await api("/api/loan/payments", {
          method: "POST",
          body: JSON.stringify({
            date: $("loanPayDate").value,
            amount: $("loanPayAmount").value,
            note: $("loanPayNote").value,
          }),
        });
        report = result.data;
        $("loanAddForm").reset();
        renderAll();
        setStatus("Payment added.");
      } catch (e) {
        setStatus(e.message);
      }
    });

    document.querySelector("#loanHistoryTable")?.addEventListener("click", async (ev) => {
      const btn = ev.target.closest(".loan-delete-btn");
      if (!btn) return;
      const id = btn.dataset.id;
      if (!id || !window.confirm("Delete this payment?")) return;
      try {
        setStatus("Deleting…");
        const result = await api(`/api/loan/payments/${encodeURIComponent(id)}`, { method: "DELETE" });
        report = result.data;
        renderAll();
        setStatus("Payment deleted.");
      } catch (e) {
        setStatus(e.message);
      }
    });

    const today = new Date().toISOString().slice(0, 10);
    if ($("loanPayDate")) $("loanPayDate").value = today;

    loadReport().catch((e) => setStatus(e.message));
  });
})();
