/**
 * Dashboard Analytics — loads inventory + orders and renders Chart.js visuals.
 * Requires global Chart from chart.umd.min.js (loaded before this script).
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
    accent: css("--chart-1", "#4f46e5"),
    font: css("--font", "system-ui, sans-serif"),
  };

  const fmtMoney = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return "—";
    const abs = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return n < 0 ? `-$${abs}` : `$${abs}`;
  };

  function portalLine(item) {
    return Number(item?.quantity || 0) > 0 && Boolean(item?.market?.sheetProductUrl);
  }

  function getGameCategory(productName) {
    const n = String(productName || "").toLowerCase();
    if (n.includes("pokemon") || n.includes("poke ")) return "Pokemon";
    if (n.includes("final fantasy") || n.includes("finalfantasy") || n.includes(" ff ") || n.startsWith("ff "))
      return "Final Fantasy";
    if (n.includes("lorcana")) return "Lorcana";
    if (n.includes("one piece")) return "One Piece";
    if (n.includes("magic") || n.includes("mtg")) return "Magic";
    if (n.includes("yugioh") || n.includes("yu-gi-oh")) return "Yu-Gi-Oh";
    return "Other";
  }

  function productFormatBucket(name) {
    const n = String(name || "").toLowerCase();
    if (/\bbooster box\b/.test(n)) return "Booster box";
    if (/\bbooster bundle\b/.test(n)) return "Booster bundle";
    if (/\betb|elite trainer box\b/.test(n)) return "ETB";
    if (/\bcollector|collectors\b/.test(n)) return "Collector";
    if (/\bcommander|commanders\b/.test(n)) return "Commander";
    if (/\bplay box|play booster\b/.test(n)) return "Play product";
    if (/\bbundle\b/.test(n)) return "Bundle";
    return "Other / sealed";
  }

  async function apiJson(url) {
    const res = await fetch(url, { headers: { "Content-Type": "application/json" } });
    const j = await res.json();
    if (!j.ok) throw new Error(j.error || "Request failed");
    return j;
  }

  function setStatus(el, text) {
    if (el) el.textContent = text;
  }

  function chartDefaults() {
    if (typeof Chart === "undefined") return;
    const muted = C.muted;
    const line = C.line;
    Chart.defaults.color = muted;
    Chart.defaults.borderColor = line;
    Chart.defaults.font.family = C.font;
    Chart.defaults.plugins.legend.labels.boxWidth = 12;
    Chart.defaults.plugins.legend.labels.padding = 14;
    Chart.defaults.plugins.tooltip.backgroundColor = C.panel;
    Chart.defaults.plugins.tooltip.titleColor = C.text;
    Chart.defaults.plugins.tooltip.bodyColor = C.text2;
    Chart.defaults.plugins.tooltip.borderColor = line;
    Chart.defaults.plugins.tooltip.borderWidth = 1;
  }

  function emptyChart(canvas, message) {
    const wrap = canvas.parentElement;
    const w = wrap?.clientWidth || 400;
    const h = wrap?.clientHeight || 260;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = C.muted;
    ctx.font = `14px ${C.font}`;
    ctx.textAlign = "center";
    ctx.fillText(message || "Not enough data yet", w / 2, h / 2);
  }

  document.addEventListener("DOMContentLoaded", async () => {
    const statusEl = document.getElementById("dashboardStatus");
    chartDefaults();

    let dashboard;
    let orders = [];
    try {
      const d = await apiJson("/api/inventory/dashboard");
      dashboard = d.data;
    } catch (e) {
      setStatus(statusEl, `Inventory load failed: ${e.message}`);
      return;
    }
    try {
      const o = await apiJson("/api/orders");
      orders = Array.isArray(o.orders) ? o.orders : [];
    } catch {
      orders = [];
    }

    const items = Array.isArray(dashboard?.items) ? dashboard.items : [];
    const lines = items.filter(portalLine);
    const priced = lines.filter((it) => it.metrics?.marketPriceKnown);
    const withProfit = priced.filter((it) => Number.isFinite(Number(it.metrics?.totalBestProfit)));

    let green = 0;
    let red = 0;
    let flat = 0;
    let unknown = 0;
    for (const it of priced) {
      const p = Number(it.metrics.totalBestProfit);
      if (!Number.isFinite(p)) {
        unknown += 1;
        continue;
      }
      if (p > 0) green += 1;
      else if (p < 0) red += 1;
      else flat += 1;
    }
    unknown += lines.length - priced.length;

    const t = dashboard.totals || {};
    const year = new Date().getFullYear();
    const ytdOrders = orders.filter((o) => String(o.purchaseDate || "").startsWith(String(year)));
    const ytdOrderTotal = ytdOrders.reduce((a, o) => a + Number(o.orderAmount || 0), 0);

    const inStockProfitSum = lines.reduce((a, it) => {
      const p = Number(it.metrics?.totalBestProfit);
      return a + (Number.isFinite(p) ? p : 0);
    }, 0);

    const kpi = document.getElementById("dashboardKpis");
    if (kpi) {
      kpi.innerHTML = `
        <div class="card"><div class="card-label">In-stock items (with TCG link)</div><div class="card-value">${lines.length}</div></div>
        <div class="card"><div class="card-label">Priced items that make money</div><div class="card-value">${priced.length ? Math.round((green / priced.length) * 100) : 0}%</div></div>
        <div class="card"><div class="card-label">Estimated profit (in-stock)</div><div class="card-value">${fmtMoney(inStockProfitSum)}</div></div>
        <div class="card"><div class="card-label">Estimated profit (every row)</div><div class="card-value">${fmtMoney(t.bestProfit)}</div></div>
        <div class="card"><div class="card-label">${year} orders · total dollars</div><div class="card-value">${ytdOrders.length} · ${fmtMoney(ytdOrderTotal)}</div></div>
      `;
    }

    if (typeof Chart === "undefined") {
      setStatus(statusEl, "Chart library failed to load.");
      return;
    }

    const commonOpts = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: "bottom" } },
    };

    /* 0 — Winning items profit over time */
    const history = Array.isArray(dashboard?.profitHistory) ? dashboard.profitHistory : [];
    const c0 = document.getElementById("chartWinnersOverTime");
    if (c0) {
      const sortedHistory = [...history].sort((a, b) => String(a.at).localeCompare(String(b.at)));
      if (!sortedHistory.length) {
        requestAnimationFrame(() => emptyChart(c0, "Import inventory and refresh prices to start tracking."));
      } else {
        new Chart(c0, {
          type: "line",
          data: {
            labels: sortedHistory.map((pt) => {
              const d = new Date(pt.at);
              return Number.isNaN(d.getTime())
                ? String(pt.at)
                : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
            }),
            datasets: [
              {
                label: "Winning items profit ($)",
                data: sortedHistory.map((pt) => Number(pt.profitWinnersOnly)),
                fill: true,
                tension: 0.25,
                borderColor: "#34d399",
                backgroundColor: "rgba(52, 211, 153, 0.12)",
                pointBackgroundColor: "#34d399",
                pointRadius: 4,
              },
            ],
          },
          options: {
            ...commonOpts,
            scales: {
              y: {
                beginAtZero: false,
                grid: { color: C.line },
                ticks: {
                  callback: (v) => {
                    const n = Number(v);
                    if (!Number.isFinite(n)) return v;
                    return n >= 0 ? `$${n.toLocaleString()}` : `-$${Math.abs(n).toLocaleString()}`;
                  },
                },
              },
              x: { grid: { display: false }, ticks: { maxRotation: 45, minRotation: 0, font: { size: 10 } } },
            },
            plugins: {
              ...commonOpts.plugins,
              title: {
                display: true,
                text: "Sum of positive line profits only",
                color: C.text,
                font: { size: 13 },
              },
              tooltip: {
                callbacks: {
                  label: (ctx) => ` ${fmtMoney(ctx.parsed.y)}`,
                },
              },
            },
          },
        });
      }
    }

    /* 1 — Profit mix (in-stock, priced) */
    const c1 = document.getElementById("chartProfitMix");
    if (c1) {
      if (priced.length === 0) requestAnimationFrame(() => emptyChart(c1, "Import inventory and refresh prices first."));
      else {
        new Chart(c1, {
          type: "doughnut",
          data: {
            labels: ["Making money", "Losing on paper", "About even", "No price yet"],
            datasets: [
              {
                data: [green, red, flat, unknown],
                backgroundColor: ["#34d399", "#f87171", "#94a3b8", "#475569"],
                borderWidth: 0,
                hoverOffset: 6,
              },
            ],
          },
          options: {
            ...commonOpts,
            cutout: "58%",
            plugins: {
              ...commonOpts.plugins,
              title: { display: true, text: "In-stock items with a TCG link", color: C.text, font: { size: 13 } },
            },
          },
        });
      }
    }

    /* 2 — Order dollars by month (YTD) */
    const c2 = document.getElementById("chartOrdersGmv");
    const byMonth = new Map();
    for (let m = 1; m <= 12; m++) byMonth.set(`${year}-${String(m).padStart(2, "0")}`, 0);
    for (const o of ytdOrders) {
      const key = String(o.purchaseDate || "").slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(key)) continue;
      byMonth.set(key, (byMonth.get(key) || 0) + Number(o.orderAmount || 0));
    }
    const monthLabels = [...byMonth.keys()].sort();
    const monthVals = monthLabels.map((k) => byMonth.get(k));
    if (c2) {
      if (!ytdOrders.length) requestAnimationFrame(() => emptyChart(c2, "No orders this year yet."));
      else {
        new Chart(c2, {
          type: "line",
          data: {
            labels: monthLabels.map((k) => {
              const [, mo] = k.split("-");
              return `${year}-${mo}`;
            }),
            datasets: [
              {
                label: "Order total ($)",
                data: monthVals,
                fill: true,
                tension: 0.35,
                borderColor: C.accent,
                backgroundColor: "rgba(99, 102, 241, 0.12)",
                pointBackgroundColor: C.accent,
                pointRadius: 4,
              },
            ],
          },
          options: {
            ...commonOpts,
            scales: {
              y: { beginAtZero: true, grid: { color: C.line } },
              x: { grid: { display: false } },
            },
            plugins: {
              ...commonOpts.plugins,
              title: { display: true, text: `${year} — all order totals added up`, color: C.text, font: { size: 13 } },
            },
          },
        });
      }
    }

    /* 3 — Estimated profit by category */
    const catMap = new Map();
    for (const it of withProfit) {
      const c = getGameCategory(it.productName);
      const p = Number(it.metrics.totalBestProfit);
      catMap.set(c, (catMap.get(c) || 0) + p);
    }
    const c3 = document.getElementById("chartCategoryProfit");
    if (c3) {
      if (!catMap.size) requestAnimationFrame(() => emptyChart(c3, "No priced in-stock items yet."));
      else {
        const sorted = [...catMap.entries()].sort((a, b) => b[1] - a[1]);
        new Chart(c3, {
          type: "bar",
          data: {
            labels: sorted.map(([k]) => k),
            datasets: [
              {
                label: "Estimated profit ($)",
                data: sorted.map(([, v]) => v),
                backgroundColor: sorted.map(([, v]) => (v >= 0 ? "rgba(52, 211, 153, 0.75)" : "rgba(248, 113, 113, 0.8)")),
                borderRadius: 6,
              },
            ],
          },
          options: {
            ...commonOpts,
            indexAxis: "y",
            scales: {
              x: { grid: { color: C.line } },
              y: { grid: { display: false } },
            },
            plugins: {
              ...commonOpts.plugins,
              title: { display: true, text: "By kind of game (in-stock, priced)", color: C.text, font: { size: 13 } },
            },
          },
        });
      }
    }

    /* 4 — Top items by estimated profit */
    const top = [...withProfit]
      .sort((a, b) => Number(b.metrics.totalBestProfit) - Number(a.metrics.totalBestProfit))
      .slice(0, 10);
    const c4 = document.getElementById("chartTopSkus");
    if (c4) {
      if (!top.length) requestAnimationFrame(() => emptyChart(c4, "No profit numbers to rank yet."));
      else {
        new Chart(c4, {
          type: "bar",
          data: {
            labels: top.map((it) => {
              const s = String(it.productName || "").trim();
              return s.length > 42 ? `${s.slice(0, 40)}…` : s;
            }),
            datasets: [
              {
                label: "Estimated profit ($)",
                data: top.map((it) => Number(it.metrics.totalBestProfit)),
                backgroundColor: "rgba(99, 102, 241, 0.75)",
                borderRadius: 6,
              },
            ],
          },
          options: {
            ...commonOpts,
            indexAxis: "y",
            scales: {
              x: { grid: { color: C.line } },
              y: { ticks: { font: { size: 11 } }, grid: { display: false } },
            },
            plugins: {
              ...commonOpts.plugins,
              title: { display: true, text: "Top 10 in-stock items", color: C.text, font: { size: 13 } },
            },
          },
        });
      }
    }

    /* 5 — Cost basis vs market value (all imported lines, dashboard totals) */
    const c5 = document.getElementById("chartCostVsMarket");
    const costB = Number(t.costBasis || 0);
    const marketB = Number(t.marketValue || 0);
    if (c5) {
      if (costB <= 0 && marketB <= 0) requestAnimationFrame(() => emptyChart(c5, "Import inventory and refresh prices."));
      else {
        new Chart(c5, {
          type: "bar",
          data: {
            labels: ["What you paid (total)", "TCG listed value (total)"],
            datasets: [
              {
                label: "Dollars",
                data: [costB, marketB],
                backgroundColor: ["rgba(148, 163, 184, 0.85)", "rgba(99, 102, 241, 0.85)"],
                borderRadius: 8,
              },
            ],
          },
          options: {
            ...commonOpts,
            scales: {
              y: { beginAtZero: true, grid: { color: C.line } },
              x: { grid: { display: false } },
            },
            plugins: {
              ...commonOpts.plugins,
              legend: { display: false },
              title: {
                display: true,
                text: "Whole file — every row, including zero quantity",
                color: C.text,
                font: { size: 13 },
              },
            },
          },
        });
      }
    }

    /* 6 — Margin % distribution (priced in-stock) */
    const bins = { "< 0%": 0, "0–8%": 0, "8–15%": 0, "15–25%": 0, "25%+": 0 };
    for (const it of priced) {
      const m = Number(it.metrics?.bestMarginPct);
      if (!Number.isFinite(m)) continue;
      if (m < 0) bins["< 0%"] += 1;
      else if (m < 8) bins["0–8%"] += 1;
      else if (m < 15) bins["8–15%"] += 1;
      else if (m < 25) bins["15–25%"] += 1;
      else bins["25%+"] += 1;
    }
    const c6 = document.getElementById("chartMarginBins");
    if (c6) {
      const totalBinned = Object.values(bins).reduce((a, n) => a + n, 0);
      if (!totalBinned) requestAnimationFrame(() => emptyChart(c6, "Run a price refresh to see margin ranges."));
      else {
        new Chart(c6, {
          type: "polarArea",
          data: {
            labels: Object.keys(bins),
            datasets: [
              {
                data: Object.values(bins),
                backgroundColor: [
                  "rgba(248, 113, 113, 0.75)",
                  "rgba(250, 204, 21, 0.7)",
                  "rgba(99, 102, 241, 0.7)",
                  "rgba(52, 211, 153, 0.75)",
                  "rgba(16, 185, 129, 0.85)",
                ],
              },
            ],
          },
          options: {
            ...commonOpts,
            scales: {
              r: {
                ticks: { backdropColor: "transparent", color: C.muted },
                grid: { color: C.line },
                angleLines: { color: C.line },
              },
            },
            plugins: {
              ...commonOpts.plugins,
              title: {
                display: true,
                text: "Profit margin ranges vs list price (in-stock, priced)",
                color: C.text,
                font: { size: 13 },
              },
            },
          },
        });
      }
    }

    /* 7 — Product format mix (counts) */
    const fmtMap = new Map();
    for (const it of lines) {
      const b = productFormatBucket(it.productName);
      fmtMap.set(b, (fmtMap.get(b) || 0) + 1);
    }
    const c7 = document.getElementById("chartFormatMix");
    if (c7) {
      if (!fmtMap.size) requestAnimationFrame(() => emptyChart(c7, "No in-stock items."));
      else {
        const ent = [...fmtMap.entries()].sort((a, b) => b[1] - a[1]);
        new Chart(c7, {
          type: "pie",
          data: {
            labels: ent.map(([k]) => k),
            datasets: [
              {
                data: ent.map(([, v]) => v),
                backgroundColor: [
                  C.accent,
                  "#818cf8",
                  "#34d399",
                  "#38bdf8",
                  "#fb7185",
                  "#2dd4bf",
                  "#a78bfa",
                  "#94a3b8",
                ],
                borderWidth: 0,
              },
            ],
          },
          options: {
            ...commonOpts,
            plugins: {
              ...commonOpts.plugins,
              title: {
                display: true,
                text: "In-stock items by product type (from name keywords)",
                color: C.text,
                font: { size: 13 },
              },
            },
          },
        });
      }
    }

    setStatus(statusEl, `Loaded ${items.length} inventory rows and ${orders.length} orders.`);
  });
})();
