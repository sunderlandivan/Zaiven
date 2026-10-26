/**
 * Shared portal chrome for every page (PC and cloud): light/dark theme with a saved toggle, sidebar icons,
 * a phone menu, and table polish (right-aligned numbers, tooltips on long text, labels for the phone card layout).
 * Loaded as a plain blocking <script> in <head> so the saved theme applies before first paint.
 */
(function () {
  "use strict";

  const KEY = "portal-theme";
  const root = document.documentElement;
  const system = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  const saved = () => {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  };
  const current = () => saved() || (system && system.matches ? "dark" : "light");
  root.dataset.theme = current();
  system?.addEventListener?.("change", () => {
    if (!saved()) root.dataset.theme = current();
  });

  const svg = (body) =>
    `<svg class="nav-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
  const ICONS = {
    orders: '<path d="M3 6h11v10H3z"/><path d="M14 9h4l3 3v4h-7"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>',
    webOrders: '<path d="M6 7h12l-1 13H7L6 7z"/><path d="M9 7a3 3 0 0 1 6 0"/>',
    stock: '<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>',
    sold: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3z"/><path d="M9 8h6M9 12h6"/>',
    sync: '<path d="M20 11a8 8 0 0 0-14.6-4.5L4 8"/><path d="M4 3v5h5"/><path d="M4 13a8 8 0 0 0 14.6 4.5L20 16"/><path d="M20 21v-5h-5"/>',
    analytics: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
    dashboard: '<path d="M3 21h18"/><path d="M6 17v-6M11 17V6M16 17v-4M20 17V9"/>',
    marketing: '<path d="M3 11v2a1 1 0 0 0 1 1h3l6 4V6L7 10H4a1 1 0 0 0-1 1z"/><path d="M16.5 9a3.5 3.5 0 0 1 0 6"/><path d="M19 6.5a7 7 0 0 1 0 11"/>',
    import: '<path d="M12 15V3"/><path d="M7 8l5-5 5 5"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
    treasure: '<path d="M6 3h12l3 6-9 12L3 9l3-6z"/><path d="M3 9h18"/><path d="M10 3l2 6 2-6"/>',
    tax: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8"/><path d="M8.5 12h.01M12 12h.01M15.5 12h.01M8.5 16h.01M12 16h.01M15.5 16h.01"/>',
    loan: '<path d="M3 10l9-6 9 6"/><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8"/><path d="M3 21h18"/>',
    settings: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
    status: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7"/><path d="M18 14a6 6 0 0 1 3.5 6"/>',
    game: '<rect x="2" y="7" width="20" height="11" rx="5"/><path d="M7 11v3M5.5 12.5h3"/><path d="M15.5 12h.01M18 14h.01"/>',
    page: '<path d="M6 3h9l3 3v15H6z"/><path d="M9 11h6M9 15h6"/>',
  };
  const SUN = '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>';
  const MOON = '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>';
  const MENU = '<path d="M4 6h16M4 12h16M4 18h16"/>';
  const ICON_BY_PATH = {
    "/inventory-orders.html": "orders",
    "/web-orders.html": "webOrders",
    "/inventory-stock.html": "stock",
    "/sold-2026.html": "sold",
    "/inventory-sheet-sync.html": "sync",
    "/inventory-analytics.html": "analytics",
    "/inventory-dashboard-analytics.html": "dashboard",
    "/inventory-marketing.html": "marketing",
    "/inventory-import.html": "import",
    "/inventory-treasure-hunt.html": "treasure",
    "/inventory-tax-prep.html": "tax",
    "/inventory-loan.html": "loan",
    "/settings.html": "settings",
    "/status.html": "status",
    "/users.html": "users",
    "/": "game",
  };

  function iconFor(a) {
    const url = new URL(a.getAttribute("href") || "", location.href);
    if (url.pathname === "/pc-only.html") return url.searchParams.get("f") === "treasure" ? "treasure" : "page";
    return ICON_BY_PATH[url.pathname] || "page";
  }

  function decorateNav() {
    document.querySelectorAll("a.nav-link, a.nav-footer-link").forEach((a) => {
      if (a.querySelector(".nav-icon")) return;
      a.insertAdjacentHTML("afterbegin", svg(ICONS[iconFor(a)]));
      if (a.classList.contains("nav-footer-link")) a.lastChild.textContent = a.lastChild.textContent.replace(/^\s*←\s*/, "");
    });
  }

  function themeToggle() {
    const brand = document.querySelector(".nav-brand");
    if (!brand || brand.querySelector(".theme-toggle")) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "theme-toggle";
    const paint = () => {
      const dark = root.dataset.theme === "dark";
      btn.innerHTML = svg(dark ? SUN : MOON);
      btn.title = dark ? "Switch to light mode" : "Switch to dark mode";
      btn.setAttribute("aria-label", btn.title);
    };
    btn.addEventListener("click", () => {
      const next = root.dataset.theme === "dark" ? "light" : "dark";
      try {
        localStorage.setItem(KEY, next);
      } catch {
        /* private mode: still switch for this page */
      }
      root.dataset.theme = next;
      paint();
      // Chart.js bakes colors into each canvas, so pages with charts redraw from scratch.
      if (document.querySelector(".chart-wrap canvas")) location.reload();
    });
    paint();
    brand.appendChild(btn);
  }

  function phoneMenu() {
    const pane = document.querySelector(".nav-pane");
    if (!pane || pane.querySelector(".cloud-menu-btn, .nav-menu-btn")) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "subtle nav-menu-btn";
    btn.setAttribute("aria-expanded", "false");
    btn.innerHTML = `${svg(MENU)}<span>Menu</span>`;
    btn.addEventListener("click", () => btn.setAttribute("aria-expanded", String(pane.classList.toggle("nav-open"))));
    pane.querySelector(".nav-brand")?.after(btn);
  }

  const NUMERIC = /^[-−+]?\s*\$?\s*[-−]?[\d,]+(\.\d+)?\s*%?\s*(\(est\.?\))?$/i;
  const INTERACTIVE = "a, button, input, select, textarea, img, video";

  function ownText(cell) {
    if (!cell.children.length) return cell.textContent.trim();
    let t = "";
    for (const n of cell.childNodes) if (n.nodeType === 3) t += n.textContent;
    return t.trim();
  }

  function enhanceTable(table) {
    const head = table.tHead?.rows[table.tHead.rows.length - 1];
    const body = table.tBodies[0];
    if (!head || !body || !body.rows.length) return;
    const labels = [...head.cells].map((th) => th.textContent.trim());
    const counts = labels.map(() => ({ num: 0, filled: 0 }));
    const rows = [...body.rows].filter((tr) => tr.cells.length === labels.length);
    for (const tr of rows) {
      [...tr.cells].forEach((td, i) => {
        if (labels[i] && !td.dataset.label) td.dataset.label = labels[i];
        if (td.querySelector("input, select, textarea, button")) return;
        const text = ownText(td);
        if (!text || text === "—") return;
        counts[i].filled += 1;
        if (NUMERIC.test(text)) counts[i].num += 1;
        if (!td.children.length && text.length > 60 && !td.classList.contains("cell-clip")) {
          td.classList.add("cell-clip");
          td.title ||= text;
          td.innerHTML = `<span class="clip"></span>`;
          td.firstChild.textContent = text;
        }
      });
    }
    counts.forEach((c, i) => {
      if (!c.filled || c.num / c.filled < 0.6) return;
      head.cells[i]?.classList.add("num");
      for (const tr of rows) if (!tr.cells[i].querySelector(INTERACTIVE)) tr.cells[i].classList.add("num");
    });
    for (const tr of body.rows) if (tr.cells.length === 1 && tr.cells[0].colSpan > 1) tr.classList.add("row-empty");
  }

  let queued = false;
  function enhanceAll() {
    queued = false;
    decorateNav();
    document.querySelectorAll(".nav-content table").forEach(enhanceTable);
  }
  const queue = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(enhanceAll);
  };

  document.addEventListener("DOMContentLoaded", () => {
    themeToggle();
    phoneMenu();
    enhanceAll();
    new MutationObserver(queue).observe(document.body, { childList: true, subtree: true });
  });
})();
