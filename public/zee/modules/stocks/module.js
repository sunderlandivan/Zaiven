import { bus } from "../../core/bus.js";

/** @param {number[]} series */
function drawSparkline(canvas, series) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const vals = (series || []).filter(Number.isFinite);
  if (vals.length < 2) {
    ctx.fillStyle = "rgba(100,200,255,0.35)";
    ctx.font = "11px Share Tech Mono, monospace";
    ctx.fillText("No chart data", 6, h / 2);
    return;
  }
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const pad = 4;
  ctx.strokeStyle = "rgba(64, 196, 255, 0.9)";
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  for (let i = 0; i < vals.length; i++) {
    const x = pad + (i / (vals.length - 1)) * (w - pad * 2);
    const t = max === min ? 0.5 : (vals[i] - min) / (max - min);
    const y = pad + (1 - t) * (h - pad * 2);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

function drawGridAndYAxis(ctx, w, h, min, max, padL, padR, padT, padB) {
  const lines = 5;
  ctx.strokeStyle = "rgba(90, 170, 215, 0.22)";
  ctx.lineWidth = 1;
  ctx.font = "11px Share Tech Mono, monospace";
  ctx.fillStyle = "rgba(163, 223, 255, 0.7)";
  for (let i = 0; i < lines; i++) {
    const t = i / (lines - 1);
    const y = padT + t * (h - padT - padB);
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(w - padR, y);
    ctx.stroke();
    const value = max - t * (max - min);
    ctx.fillText(Number.isFinite(value) ? value.toFixed(2) : "-", 4, y + 3);
  }
}

function drawLine(canvas, series, color = "rgba(86, 220, 255, 0.95)") {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const vals = (series || []).filter(Number.isFinite);
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  if (vals.length < 2) return;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const padL = 52;
  const padR = 12;
  const padT = 12;
  const padB = 24;

  drawGridAndYAxis(ctx, w, h, min, max, padL, padR, padT, padB);

  ctx.strokeStyle = color;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  for (let i = 0; i < vals.length; i++) {
    const x = padL + (i / (vals.length - 1)) * (w - padL - padR);
    const y = padT + (1 - (max === min ? 0.5 : (vals[i] - min) / (max - min))) * (h - padT - padB);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  ctx.fillStyle = "rgba(163, 223, 255, 0.7)";
  ctx.font = "11px Share Tech Mono, monospace";
  ctx.fillText("90d", padL, h - 8);
  ctx.fillText("Now", w - padR - 28, h - 8);
}

function drawBars(canvas, series) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const vals = (series || []).filter(Number.isFinite);
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  if (!vals.length) return;
  const max = Math.max(...vals, 1);
  const padL = 52;
  const padR = 12;
  const padT = 8;
  const padB = 20;

  ctx.strokeStyle = "rgba(90, 170, 215, 0.2)";
  for (let i = 0; i < 4; i++) {
    const t = i / 3;
    const y = padT + t * (h - padT - padB);
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(w - padR, y);
    ctx.stroke();
    const val = max * (1 - t);
    ctx.fillStyle = "rgba(163, 223, 255, 0.62)";
    ctx.font = "10px Share Tech Mono, monospace";
    ctx.fillText(formatCompact(val), 4, y + 3);
  }

  const n = vals.length;
  const gap = 1;
  const innerW = w - padL - padR;
  const bw = Math.max(1, Math.floor((innerW - (n - 1) * gap) / n));
  ctx.fillStyle = "rgba(95, 203, 255, 0.55)";
  for (let i = 0; i < n; i++) {
    const bh = Math.max(1, Math.floor((vals[i] / max) * (h - padT - padB)));
    const x = padL + i * (bw + gap);
    const y = h - padB - bh;
    ctx.fillRect(x, y, bw, bh);
  }
  ctx.fillStyle = "rgba(163, 223, 255, 0.7)";
  ctx.fillText("Volume", 4, h - 6);
}

async function fetchStocks(symbols) {
  const q = symbols.join(",");
  const res = await fetch(`/api/zee/stocks?symbols=${encodeURIComponent(q)}`);
  const j = await res.json();
  if (!j.ok) throw new Error(j.error || "stocks failed");
  return j.data;
}

async function fetchStockDetail(symbol) {
  const res = await fetch(`/api/zee/stocks/detail?symbol=${encodeURIComponent(symbol)}`);
  const j = await res.json();
  if (!j.ok) throw new Error(j.error || "stock detail failed");
  return j.data;
}

export const stocksModule = {
  id: "stocks",
  title: "Markets",
  mount(el) {
    el.innerHTML = `<div class="zee-stocks" id="zee-stocks-root"></div>`;
    const root = el.querySelector("#zee-stocks-root");
    const hostPanel = el.closest(".zee-panel");

    const modal = document.createElement("div");
    modal.id = "zee-stock-modal";
    modal.className = "zee-stock-modal zee-panel-hidden";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-label", "Stock spotlight");
    modal.innerHTML = `
      <div class="zee-stock-modal-card" id="zee-stock-modal-card">
        <div class="zee-stock-modal-head">
          <div class="zee-sym" id="zee-stock-modal-title">NVDA Spotlight</div>
          <button class="zee-btn zee-btn-sm" id="zee-stock-modal-close" type="button">Close</button>
        </div>
        <div class="zee-stock-modal-body">
          <div class="zee-stock-kpis" id="zee-stock-kpis"></div>
          <canvas id="zee-stock-line" width="980" height="360"></canvas>
          <canvas id="zee-stock-bars" width="980" height="220"></canvas>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const modalCard = modal.querySelector("#zee-stock-modal-card");
    const modalTitle = modal.querySelector("#zee-stock-modal-title");
    const modalKpis = modal.querySelector("#zee-stock-kpis");
    const line = modal.querySelector("#zee-stock-line");
    const bars = modal.querySelector("#zee-stock-bars");

    const showSpotlight = async (symbol = "NVDA") => {
      try {
        const d = await fetchStockDetail(symbol);
        if (modalTitle) modalTitle.textContent = `${d.symbol} Spotlight`;
        if (modalKpis) {
          modalKpis.innerHTML = `
            <div><span class="zee-muted">Price</span><strong>${fmt(d.current)}</strong></div>
            <div><span class="zee-muted">Day H/L</span><strong>${fmt(d.dayHigh)} / ${fmt(d.dayLow)}</strong></div>
            <div><span class="zee-muted">52W H/L</span><strong>${fmt(d.week52High)} / ${fmt(d.week52Low)}</strong></div>
            <div><span class="zee-muted">RSI(14)</span><strong>${d.rsi14 == null ? "-" : Number(d.rsi14).toFixed(2)}</strong></div>
          `;
        }
        if (line) drawLine(/** @type {HTMLCanvasElement} */ (line), d.closeSeries);
        if (bars) drawBars(/** @type {HTMLCanvasElement} */ (bars), d.volumeSeries);

        const rect = hostPanel?.getBoundingClientRect();
        const dx = rect ? rect.left + rect.width / 2 - window.innerWidth / 2 : 0;
        const dy = rect ? rect.top + rect.height / 2 - window.innerHeight / 2 : 0;
        modalCard?.style.setProperty("--from-x", `${dx}px`);
        modalCard?.style.setProperty("--from-y", `${dy}px`);

        modal.classList.remove("zee-panel-hidden");
        requestAnimationFrame(() => modal.classList.add("zee-stock-modal-open"));
      } catch (e) {
        if (root) root.insertAdjacentHTML("beforeend", `<div class="zee-err">${String(e.message || e)}</div>`);
      }
    };

    const closeModal = () => {
      modal.classList.remove("zee-stock-modal-open");
      setTimeout(() => modal.classList.add("zee-panel-hidden"), 200);
      bus.emit("spotlight:closed", { target: "stock" });
    };

    modal.querySelector("#zee-stock-modal-close")?.addEventListener("click", closeModal);
    modal.addEventListener("click", (ev) => {
      if (ev.target === modal) closeModal();
    });

    const WATCHLIST = [
      { key: "NVDA", fetch: "NVDA", label: "NVDA" },
      { key: "SPY", fetch: "SPY", label: "SPY" },
      { key: "SPXL", fetch: "SPXL", label: "SPXL" },
      { key: "APLX", fetch: "APLX", label: "APLX" },
      { key: "TSLA", fetch: "TSLA", label: "TSLA" },
      { key: "GLD", fetch: "GLD", label: "GLD" },
      { key: "DOGE", fetch: "DOGE-USD", label: "DOGE (crypto)" },
    ];

    const refresh = async () => {
      try {
        const data = await fetchStocks(WATCHLIST.map((x) => x.fetch));
        const rows = WATCHLIST
          .map((item) => {
            const row = data[item.fetch];
            if (!row) return "";
            if (row.error) {
              return `<div class="zee-stock-row"><div class="zee-sym">${item.label}</div><div class="zee-err">${row.error}</div></div>`;
            }
            const ch =
              row.changePct == null
                ? ""
                : ` <span class="${row.changePct >= 0 ? "zee-up" : "zee-down"}">${row.changePct >= 0 ? "+" : ""}${row.changePct.toFixed(2)}%</span>`;
            return `
              <div class="zee-stock-row" data-sym="${item.fetch}">
                <div>
                  <div class="zee-sym">${item.label}</div>
                  <div class="zee-price">${row.current != null ? row.current.toFixed(2) : "-"}${ch}</div>
                </div>
                <button class="zee-btn zee-btn-sm" data-spot="${item.fetch}" type="button">Spotlight</button>
                <canvas class="zee-spark" width="140" height="44" data-sym="${item.fetch}"></canvas>
              </div>`;
          })
          .join("");
        if (root) root.innerHTML = rows || "<div class='zee-muted'>No data</div>";
        for (const item of WATCHLIST) {
          const row = data[item.fetch];
          const cv = root?.querySelector(`canvas[data-sym="${item.fetch}"]`);
          if (cv && row?.sparkline) drawSparkline(/** @type {HTMLCanvasElement} */ (cv), row.sparkline);
        }
        root?.querySelectorAll("[data-spot]").forEach((btn) => {
          btn.addEventListener("click", () => showSpotlight(String(btn.getAttribute("data-spot") || "NVDA")));
        });
      } catch (e) {
        if (root) {
          root.innerHTML = `<div class="zee-err">${String(e.message || e)}</div><div class="zee-muted">Set STOCKS_API_KEY (Finnhub).</div>`;
        }
      }
    };

    refresh();
    const offSpot = bus.on("stock:spotlight", ({ symbol }) => {
      showSpotlight(String(symbol || "NVDA"));
    });
    const offSpotClose = bus.on("spotlight:close", ({ target }) => {
      if (target === "all" || target === "stock") closeModal();
    });
    const id = window.setInterval(refresh, 10_000);

    return {
      destroy() {
        offSpot();
        offSpotClose();
        modal.remove();
        window.clearInterval(id);
      },
    };
  },
};

function fmt(v) {
  return Number.isFinite(Number(v)) ? Number(v).toFixed(2) : "-";
}

function formatCompact(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "-";
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return Math.round(n).toString();
}
