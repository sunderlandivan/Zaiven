// Cloud shell for every portal page: role-based nav, sign-out, shadow-mode locks and "Available on the PC portal" notes.
// Loaded with `defer` ahead of each page's own script, so the DOM is parsed but the page hasn't bound its handlers yet.
// Locks here are only for clarity; the Worker enforces roles and shadow mode on every API call.
(function () {
  "use strict";

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const money = (n) => (n == null || n === "" || !Number.isFinite(Number(n)) ? "—" : `${Number(n) < 0 ? "-" : ""}$${Math.abs(Number(n)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  const when = (s) => (s ? new Date(s).toLocaleString() : "never");
  const RANK = { viewer: 1, staff: 1, manager: 2, owner: 3 };
  const atLeast = (role, min) => (RANK[role] || 0) >= RANK[min];
  const PAGE = location.pathname;
  const SHADOW_TIP = "Read-only until switch-over";
  const PC_TIP = "Available on the PC portal";
  const VIEWER_TIP = "Your account is view-only";

  // Every same-origin write carries the session's CSRF token (the Worker refuses writes without it), including the
  // PC pages' own fetch calls. A 401 anywhere means the session ended: sign in again.
  let csrfToken = "";
  let whoami = null;
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const req = input instanceof Request ? input : null;
    const method = String(init.method || req?.method || "GET").toUpperCase();
    const sameSite = new URL(req ? req.url : String(input), location.href).origin === location.origin;
    if (sameSite && method !== "GET" && method !== "HEAD") {
      if (!csrfToken && whoami) await whoami.catch(() => {});
      const headers = new Headers(init.headers || req?.headers || undefined);
      headers.set("X-CSRF-Token", csrfToken);
      init = { ...init, headers };
    }
    const res = await realFetch(input, init);
    if (res.status === 401) location.href = "/auth/login";
    return res;
  };

  async function api(path, opts = {}) {
    const res = await fetch(path, { ...opts, headers: { "Content-Type": "application/json", ...(opts.headers || {}) } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.ok === false) throw Object.assign(new Error(body.error || `HTTP ${res.status}`), { status: res.status, body });
    return body;
  }

  const NAV = [
    ["Daily", [
      ["Web Orders", "/web-orders.html", "staff"],
      ["Order Tracking", "/inventory-orders.html", "staff"],
      ["Inventory", "/inventory-stock.html", "staff"],
    ]],
    ["Business", [
      ["Sold 2026", "/sold-2026.html", "manager"],
      ["Sheet Sync", "/inventory-sheet-sync.html", "manager"],
      ["Selling Analytics", "/inventory-analytics.html", "manager"],
      ["Dashboard Analytics", "/inventory-dashboard-analytics.html", "manager"],
      ["Marketing", "/inventory-marketing.html", "manager"],
      ["Import and Pricing", "/inventory-import.html", "manager", true],
      ["Treasure Hunt", "/pc-only.html?f=treasure", "manager", true],
    ]],
    ["Owner", [
      ["Tax Prep", "/inventory-tax-prep.html", "owner"],
      ["Loan", "/inventory-loan.html", "owner"],
      ["Store Settings", "/settings.html", "owner"],
      ["Cloud Status", "/status.html", "owner"],
      ["Users & Audit", "/users.html", "owner"],
    ]],
  ];

  // Per page: panels the PC alone can run (content hidden, note shown), controls that write (locked in shadow mode),
  // PC-only controls (always locked here), parts hidden below a role, and a note under the page title.
  const PAGES = {
    "/inventory-orders.html": {
      pcPanels: { "#connectGmailBtn": "Gmail order sync runs on the PC portal.", "#ordersCsvPath": "CSV import reads files on the PC, so it runs on the PC portal." },
      shadow: ["#orderForm button[type=submit]"],
      minRole: { "section:has(#orderForm)": "manager" },
    },
    "/inventory-stock.html": {
      pc: ["#stockAutoMatchBtn", ".confirm-match-btn", ".ignore-match-btn", ".match-item-select"],
      minRole: { "#needsMatchPanel": "manager", "#stockAutoMatchBtn": "manager" },
      note: "Stock as last copied from the PC portal. Matching sales to inventory happens on the PC portal.",
    },
    "/inventory-import.html": {
      pcPanels: { "#inventoryFile": "Excel imports read files on the PC.", "#scanBtn": "Market price refreshes run on the PC portal.", "#resetInventoryBtn": "Data resets run on the PC portal." },
      importStatus: true,
    },
    "/inventory-sheet-sync.html": {
      pc: ["#syncRunBtn", "#syncConnectBtn", "#syncTestBtn", "#syncSaveSettingsBtn", ".sync-apply-btn", ".sync-ignore-btn", ".sync-lines select", ".sync-lines input", "#setEnabled", "#setAutoApply", "#setInterval", "#setTrackFrom", "#setPurchaseTab", "#setSoldTab", "#setStockTabs", "#setSenders", "#setSheetId"],
      note: "Gmail reading and writing to the Sheet run on the PC portal. This shows the review queue as last copied, and the cloud's read-only mirror of Inventory26 / Sold 2026.",
    },
    "/inventory-marketing.html": {
      pcPanels: { "#psMake": "Promo Shorts are rendered with ffmpeg on the PC." },
      shadow: ["#mkSync", "[data-act=approved]", "[data-act=posted]", "[data-act=rejected]", "[data-paid]", "[data-cancel]"],
      pc: ["[data-short]"],
      minRole: { "#mkSync": "owner", "section:has(#taxReport)": "owner" },
    },
    "/inventory-tax-prep.html": {
      pc: [".tax-snapshot-btn", ".tax-add-row-btn", ".tax-save-section-btn", ".tax-add-expense-btn", ".tax-del-row-btn", "section.tax-section table input", "section.tax-section table select"],
      note: "Read-only view. Editing and inventory snapshots happen on the PC portal; CSV export works here.",
    },
    "/inventory-loan.html": {
      pc: ["#loanSaveMetaBtn", "#loanAddForm button", "#loanAddForm input", "#loanPrincipalInput", "#loanBankInput", "#loanPendingInput", "#loanNotesInput", ".loan-delete-btn"],
      note: "Read-only view. Loan edits happen on the PC portal.",
    },
    "/order-doc.html": { minRole: { "#docSwitch": "manager" } },
  };
  const cfg = PAGES[PAGE] || {};

  let me = null;
  let active = false;

  function lock(el, kind) {
    if (el.dataset.cloudLock === kind) return;
    el.dataset.cloudLock = kind;
    el.disabled = true;
    el.title = kind === "pc" ? PC_TIP : kind === "viewer" ? VIEWER_TIP : SHADOW_TIP;
    el.classList.add("cloud-locked");
  }
  function unlock(el) {
    delete el.dataset.cloudLock;
    el.disabled = false;
    el.removeAttribute("title");
    el.classList.remove("cloud-locked");
  }
  function applyLocks() {
    for (const sel of cfg.pc || []) document.querySelectorAll(sel).forEach((el) => lock(el, "pc"));
    if (me?.readOnly) {
      for (const sel of [...(cfg.shadow || []), ...(cfg.viewer || [])]) document.querySelectorAll(sel).forEach((el) => lock(el, "viewer"));
      return;
    }
    for (const sel of cfg.shadow || []) document.querySelectorAll(sel).forEach((el) => (active ? el.dataset.cloudLock === "shadow" && unlock(el) : lock(el, "shadow")));
  }

  function pcPanels() {
    for (const [sel, why] of Object.entries(cfg.pcPanels || {})) {
      const panel = document.querySelector(sel)?.closest("section.panel");
      if (!panel || panel.dataset.cloudPc) continue;
      panel.dataset.cloudPc = "1";
      for (const child of panel.children) if (child.tagName !== "H2") child.classList.add("cloud-hidden");
      panel.insertAdjacentHTML("beforeend", `<p class="pc-note"><strong>Available on the PC portal.</strong> ${esc(why)}</p>`);
    }
  }

  function roleGate(show) {
    for (const [sel, min] of Object.entries(cfg.minRole || {})) document.querySelectorAll(sel).forEach((el) => el.classList.toggle("cloud-hidden", !(show && atLeast(me?.role, min))));
  }

  function renderNav() {
    const pane = document.querySelector(".nav-pane");
    const nav = document.getElementById("cloudNav");
    if (!pane || !nav) return;
    const here = PAGE + (PAGE === "/pc-only.html" ? location.search : "");
    nav.innerHTML = NAV.map(([group, links]) => {
      const visible = links.filter(([, , min]) => atLeast(me.role, min));
      if (!visible.length) return "";
      return `<div class="nav-group">${esc(group)}</div>${visible
        .map(([label, href, , pc]) => `<a class="nav-link${href === here ? " active" : ""}" href="${href}">${esc(label)}${pc ? ' <span class="pc-badge" title="Runs on the PC portal">PC</span>' : ""}</a>`)
        .join("")}`;
    }).join("");
    pane.querySelector(".cloud-user")?.remove();
    pane.insertAdjacentHTML(
      "beforeend",
      `<div class="cloud-user"><div class="cloud-user-name">${esc(me.name || me.email)}</div><div class="cloud-user-mail">${esc(me.email)}</div>
        <span class="role-pill role-${esc(me.role)}">${esc(me.role)}</span>
        <form method="post" action="/auth/logout"><input type="hidden" name="csrf" value="${esc(me.csrfToken)}"><button type="submit" class="subtle cloud-logout">Sign out</button></form></div>`
    );
  }

  function mobileMenu() {
    const pane = document.querySelector(".nav-pane");
    if (!pane || pane.querySelector(".cloud-menu-btn")) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "subtle cloud-menu-btn";
    btn.setAttribute("aria-expanded", "false");
    btn.textContent = "Menu";
    btn.addEventListener("click", () => btn.setAttribute("aria-expanded", String(pane.classList.toggle("nav-open"))));
    pane.querySelector(".nav-brand")?.after(btn);
  }

  function banner() {
    const main = document.querySelector(".nav-content");
    if (main && me.readOnly) {
      main.insertAdjacentHTML("afterbegin", '<div class="shadow-banner"><strong>View-only account.</strong> You can look at everything on these pages, but nothing can be changed from this account.</div>');
      return;
    }
    if (!main || active) return;
    if (me.portalMode === "passive") {
      main.insertAdjacentHTML("afterbegin", '<div class="shadow-banner"><strong>Passive: the PC portal is in charge.</strong> The cloud is in active mode but doesn\'t hold the host lease yet, so it stays read-only. Hand over on Cloud Status.</div>');
      return;
    }
    const copied = me.dataCopiedAt ? ` PC data copied ${esc(when(me.dataCopiedAt))}.` : "";
    main.insertAdjacentHTML("afterbegin", `<div class="shadow-banner"><strong>Shadow mode: read-only until switch-over.</strong> The PC portal is still the active host.${copied} Website stock and the Sheet mirror refresh every few minutes.</div>`);
  }

  function pageNote() {
    if (!cfg.note) return;
    document.querySelector(".content-header")?.insertAdjacentHTML("afterend", `<p class="help cloud-note">${esc(cfg.note)}</p>`);
  }

  async function importStatus() {
    const el = document.getElementById("status");
    if (!el) return;
    try {
      const d = (await api("/api/inventory/dashboard")).data;
      const checked = d.items.map((i) => i.market?.lastCheckedAt).filter(Boolean).sort();
      el.textContent = d.importedAt
        ? `Last Excel import ${when(d.importedAt)} · ${d.items.length} rows · prices last refreshed ${when(checked.at(-1))}.`
        : "No inventory imported yet.";
    } catch (e) {
      el.textContent = e.message;
    }
  }

  function pcOnlyPage() {
    if (PAGE !== "/pc-only.html") return;
    const info = {
      treasure: ["Treasure Hunt", "Deal scans search store websites from the PC on a schedule. Open the PC portal to review hits and log deals."],
    }[new URLSearchParams(location.search).get("f")];
    if (!info) return;
    document.getElementById("pcTitle").textContent = info[0];
    document.getElementById("pcWhy").textContent = info[1];
  }

  // Before the role is known: PC panels and locks apply to everyone, role-gated parts stay hidden.
  document.body.classList.add("cloud");
  pcOnlyPage();
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-cloud-print]")) window.print();
  });
  mobileMenu();
  pcPanels();
  roleGate(false);
  applyLocks();
  pageNote();
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      applyLocks();
    });
  }).observe(document.body, { childList: true, subtree: true });

  const ready = (whoami = api("/api/whoami")).then((who) => {
    me = who;
    csrfToken = who.csrfToken || "";
    active = who.portalMode === "active";
    document.body.classList.add(`role-${who.role}`);
    if (PAGE === "/order-doc.html" && !atLeast(who.role, "manager") && new URLSearchParams(location.search).get("type") === "invoice") {
      location.replace(location.pathname + location.search.replace("type=invoice", "type=slip"));
    }
    renderNav();
    roleGate(true);
    applyLocks();
    if (PAGE !== "/order-doc.html") banner();
    if (cfg.importStatus) importStatus();
    return who;
  });
  ready.catch(() => {});

  window.Cloud = { api, esc, money, when, atLeast, ready, SHADOW_TIP, PC_TIP, VIEWER_TIP };
})();
