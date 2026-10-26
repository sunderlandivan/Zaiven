import { bus } from "./bus.js";

/** @typedef {{ id: string, title: string, defaultHidden?: boolean, mount: (el: HTMLElement) => { destroy?: () => void } } } ZeeModule */

/** @type {Map<string, ZeeModule>} */
const modules = new Map();

/** @type {Map<string, { el: HTMLElement, api?: ReturnType<ZeeModule['mount']> }>} */
const instances = new Map();
let activeDrilldownClose = null;

/** @type {ResizeObserver | null} */
let layoutDebugRo = null;
/** @type {(() => void) | null} */
let layoutDebugOnResize = null;

const LAYOUT_DEBUG_LS_KEY = "zee.layoutDebug";

export const registry = {
  /**
   * @param {ZeeModule} mod
   */
  register(mod) {
    modules.set(mod.id, mod);
  },
  get(id) {
    return modules.get(id);
  },
  all() {
    return [...modules.values()];
  },
  /**
   * @param {HTMLElement} grid
   */
  mountAll(grid) {
    syncLayoutDebugClassFromEnvironment();
    scrubObsoleteZeeHudKeys();
    migrateClearSavedFloatPositions();
    scrubLegacyFloatCoordsFromDisk();
    for (const mod of modules.values()) {
      const wrap = document.createElement("section");
      wrap.className = "zee-panel";
      wrap.dataset.moduleId = mod.id;
      if (mod.defaultHidden) wrap.classList.add("zee-panel-hidden");
      wrap.innerHTML = `
        <header class="zee-panel-head">
          <div class="zee-panel-head-left">
            <span class="zee-panel-title">${escapeHtml(mod.title)}</span>
            <span class="zee-panel-layout-metrics" aria-hidden="true"></span>
          </div>
          <span class="zee-panel-head-actions">
            <button type="button" class="zee-panel-expand" title="Drill down">⤢</button>
            <span class="zee-panel-drag" aria-hidden="true">⠿</span>
          </span>
        </header>
        <div class="zee-panel-body" id="zee-panel-body-${mod.id}"></div>
      `;
      grid.appendChild(wrap);
      const body = wrap.querySelector(`#zee-panel-body-${mod.id}`);
      const api = mod.mount(/** @type {HTMLElement} */ (body));
      instances.set(mod.id, { el: wrap, api });
      wireResize(wrap);
      wireDrag(wrap);
      wireDrilldown(wrap, mod.id, mod.title);
    }
    for (const { el } of instances.values()) {
      stripOrphanAbsolutePanelStyles(el);
    }
    for (const { el } of instances.values()) {
      snapPanelToGrid(el);
      stripOrphanAbsolutePanelStyles(el);
    }
    setupLayoutDebugMetrics(grid);
  },
  openModule(id) {
    const hit = instances.get(id);
    if (!hit) return { ok: false, error: "unknown module" };
    hit.el.classList.remove("zee-panel-hidden");
    bus.emit("module:opened", { id });
    return { ok: true };
  },
  closeModule(id) {
    const hit = instances.get(id);
    if (!hit) return { ok: false, error: "unknown module" };
    hit.el.classList.add("zee-panel-hidden");
    bus.emit("module:closed", { id });
    return { ok: true };
  },
  focusModule(id) {
    const hit = instances.get(id);
    if (!hit) return { ok: false, error: "unknown module" };
    hit.el.classList.remove("zee-panel-hidden");
    hit.el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    hit.el.classList.add("zee-panel-flash");
    setTimeout(() => hit.el.classList.remove("zee-panel-flash"), 900);
    return { ok: true };
  },
  /**
   * Re-read layout debug (`?layoutDebug=1` or `localStorage zee.layoutDebug=1`).
   * Call after changing the URL without a full reload if you manipulate search params in JS.
   */
  syncLayoutDebugFromEnvironment() {
    syncLayoutDebugClassFromEnvironment();
    const grid = document.getElementById("zee-grid");
    if (grid instanceof HTMLElement) setupLayoutDebugMetrics(grid);
    else refreshAllPanelLayoutMetrics();
  },
};

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Default true: panels stay on the CSS grid until the user unlocks layout in the top bar. */
/** v3: panel width/height/jx/jy; x/y = free-drag (cleared by layout schema migration). */
const PANEL_SIZES_KEY = "zee.panelSizes.v3";
/** Bump when default grid changes so saved x/y cannot stack panels over the new layout. */
const HUD_LAYOUT_SCHEMA_KEY = "zee.hudLayout.schema";
/** Zee dashboard baseline requested by user, project v2.0. */
const HUD_LAYOUT_SCHEMA_VALUE = "layout-v2.0-2026-05-07-stable-right-rail-ring";
const PANEL_MIN_W = 180;
const PANEL_MIN_H = 100;

/** @typedef {{ w?: number; h?: number; jx?: string; jy?: string; x?: number; y?: number }} ZeePanelSize */

/** @returns {Record<string, ZeePanelSize>} */
function readPanelSizes() {
  try {
    return JSON.parse(localStorage.getItem(PANEL_SIZES_KEY) || "{}");
  } catch {
    return {};
  }
}

function scrubObsoleteZeeHudKeys() {
  try {
    localStorage.removeItem("zee.layoutSnapLocked");
  } catch {
    /* ignore */
  }
}

/** @param {() => void} fn @param {number} ms */
function debounce(fn, ms) {
  let t = 0;
  return () => {
    window.clearTimeout(t);
    t = window.setTimeout(fn, ms);
  };
}

/** Opt-in: `?layoutDebug=1` or `localStorage zee.layoutDebug=1`. Off: missing key, `?layoutDebug=0`, or LS `0`. */
function syncLayoutDebugClassFromEnvironment() {
  let on = false;
  try {
    const p = new URLSearchParams(window.location.search);
    const q = p.get("layoutDebug");
    if (q === "1") on = true;
    else if (q === "0") on = false;
    else if (localStorage.getItem(LAYOUT_DEBUG_LS_KEY) === "1") on = true;
  } catch {
    /* ignore */
  }
  document.body.classList.toggle("zee-layout--debug-layout", on);
  return on;
}

/**
 * @param {CSSStyleDeclaration} cs
 * @param {"column"|"row"} axis
 */
function readCssGridSpan(cs, axis) {
  const start = (axis === "column" ? cs.gridColumnStart : cs.gridRowStart).trim();
  const end = (axis === "column" ? cs.gridColumnEnd : cs.gridRowEnd).trim();
  const m = /^span\s+(\d+)/i.exec(end);
  if (m) return String(parseInt(m[1], 10));
  const si = parseInt(start, 10);
  const ei = parseInt(end, 10);
  if (Number.isFinite(si) && Number.isFinite(ei) && ei > si) return String(ei - si);
  return end || "?";
}

/** @param {HTMLElement} wrap */
function refreshPanelLayoutMetrics(wrap) {
  const el = wrap.querySelector(".zee-panel-layout-metrics");
  if (!(el instanceof HTMLElement)) return;
  if (!document.body.classList.contains("zee-layout--debug-layout")) {
    el.textContent = "";
    return;
  }
  const cs = getComputedStyle(wrap);
  const r = wrap.getBoundingClientRect();
  const id = wrap.dataset.moduleId || "?";
  const zx = cs.zIndex;
  const z = zx === "auto" ? "auto" : zx;
  el.textContent = `id: ${id} | x-span: ${readCssGridSpan(cs, "column")} | y-span: ${readCssGridSpan(cs, "row")} | z: ${z} | size: ${Math.round(r.width)}×${Math.round(r.height)}px`;
}

function refreshAllPanelLayoutMetrics() {
  for (const { el } of instances.values()) refreshPanelLayoutMetrics(el);
}

function teardownLayoutDebugMetrics() {
  if (layoutDebugRo) {
    layoutDebugRo.disconnect();
    layoutDebugRo = null;
  }
  if (layoutDebugOnResize) {
    window.removeEventListener("resize", layoutDebugOnResize);
    layoutDebugOnResize = null;
  }
}

/** @param {HTMLElement} grid */
function setupLayoutDebugMetrics(grid) {
  teardownLayoutDebugMetrics();
  const run = () => refreshAllPanelLayoutMetrics();
  if (!document.body.classList.contains("zee-layout--debug-layout")) {
    run();
    return;
  }
  const debounced = debounce(run, 100);
  layoutDebugOnResize = debounced;
  window.addEventListener("resize", debounced);
  layoutDebugRo = new ResizeObserver(() => debounced());
  layoutDebugRo.observe(grid);
  for (const { el } of instances.values()) layoutDebugRo.observe(el);
  run();
}

/**
 * When the hub grid template changes, drop all saved geometry (drag + edge resize).
 * Otherwise old pixel widths (e.g. very wide Music) spill out of grid cells and overlap neighbors.
 */
function migrateClearSavedFloatPositions() {
  try {
    if (localStorage.getItem(HUD_LAYOUT_SCHEMA_KEY) === HUD_LAYOUT_SCHEMA_VALUE) return;
    localStorage.removeItem(PANEL_SIZES_KEY);
    localStorage.setItem(HUD_LAYOUT_SCHEMA_KEY, HUD_LAYOUT_SCHEMA_VALUE);
  } catch {
    /* ignore */
  }
}

/** Stale drag state: absolute without float cookie — snap back to grid flow. */
function stripOrphanAbsolutePanelStyles(wrap) {
  if (wrap.dataset.zeeFloated === "1") return;
  const pos = wrap.style.position;
  if (pos !== "absolute" && pos !== "fixed") return;
  wrap.style.position = "";
  wrap.style.left = "";
  wrap.style.top = "";
  wrap.style.transform = "";
  wrap.style.zIndex = "";
  wrap.style.gridColumn = "";
  wrap.style.gridRow = "";
  wrap.style.minHeight = "";
  wrap.style.willChange = "";
  wrap.style.width = "";
  wrap.style.maxWidth = "";
  wrap.style.minWidth = "";
  wrap.classList.remove("zee-panel--floated");
}

/** @param {string} id @param {ZeePanelSize} patch */
function writePanelSize(id, patch) {
  const all = readPanelSizes();
  const merged = { ...all[id], ...patch };
  delete merged.x;
  delete merged.y;
  all[id] = merged;
  localStorage.setItem(PANEL_SIZES_KEY, JSON.stringify(all));
}

/** Remove legacy x/y from disk (float is session-only; these caused post-refresh overlap). */
function scrubLegacyFloatCoordsFromDisk() {
  try {
    const raw = localStorage.getItem(PANEL_SIZES_KEY);
    if (!raw) return;
    const all = JSON.parse(raw);
    let changed = false;
    for (const k of Object.keys(all)) {
      const e = all[k];
      if (!e) continue;
      if (e.x != null || e.y != null) {
        delete e.x;
        delete e.y;
        changed = true;
        if (Object.keys(e).length === 0) delete all[k];
      }
    }
    if (changed) localStorage.setItem(PANEL_SIZES_KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}

/** @param {number} n @param {number} lo @param {number} hi */
function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

/** @param {HTMLElement} wrap */
function applyStoredPanelSize(wrap) {
  const id = wrap.dataset.moduleId;
  if (!id) return;
  const s = readPanelSizes()[id];
  const floated = wrap.dataset.zeeFloated === "1";
  if (!s || (s.w == null && s.h == null)) {
    if (!floated) {
      wrap.dataset.zeeUserSized = "";
      wrap.classList.remove("zee-panel--user-sized");
      wrap.style.width = "";
      wrap.style.maxWidth = "";
      wrap.style.minWidth = "";
    }
    return;
  }
  wrap.dataset.zeeUserSized = "1";
  wrap.classList.add("zee-panel--user-sized");
  wrap.style.boxSizing = "border-box";
  const grid = wrap.parentElement;
  const maxW = grid ? grid.clientWidth - 8 : window.innerWidth - 24;
  const maxH = window.innerHeight - 24;
  if (s.w != null && Number.isFinite(s.w)) {
    const w = clamp(s.w, PANEL_MIN_W, maxW);
    if (!floated) {
      wrap.style.width = "100%";
      wrap.style.maxWidth = `min(100%, ${w}px)`;
      wrap.style.minWidth = "0";
      if (s.jx === "end") wrap.style.justifySelf = "end";
      else wrap.style.justifySelf = "start";
    } else {
      wrap.style.width = `${w}px`;
      wrap.style.maxWidth = `${w}px`;
      wrap.style.minWidth = `${Math.min(PANEL_MIN_W, w)}px`;
      wrap.style.justifySelf = "";
    }
  }
  if (s.h != null && Number.isFinite(s.h)) {
    /* Right-rail guard: saved pixel heights can exceed fixed grid spans and paint over neighbors. */
    if (!floated && (id === "time" || id === "system" || id === "communications")) {
      wrap.style.height = "";
      wrap.style.maxHeight = "";
      wrap.style.alignSelf = "";
      const all = readPanelSizes();
      const cur = all[id] ? { ...all[id] } : {};
      if (cur.h != null || cur.jy) {
        delete cur.h;
        delete cur.jy;
        if (Object.keys(cur).length === 0) delete all[id];
        else all[id] = cur;
        localStorage.setItem(PANEL_SIZES_KEY, JSON.stringify(all));
      }
      if (!all[id] || Object.keys(all[id]).length === 0) {
        wrap.dataset.zeeUserSized = "";
        wrap.classList.remove("zee-panel--user-sized");
      }
    } else {
      const h = clamp(s.h, PANEL_MIN_H, maxH);
      wrap.style.height = `${h}px`;
      wrap.style.maxHeight = `${h}px`;
      if (!floated) {
        if (s.jy === "end") wrap.style.alignSelf = "end";
        else wrap.style.alignSelf = "start";
      } else {
        wrap.style.alignSelf = "";
      }
    }
  }
}

/** Re-apply saved edge sizes only. Drag offsets (float) are not restored after reload. */
function applyStoredPanelLayout(wrap) {
  applyStoredPanelSize(wrap);
}

/** Clear any free-drag / absolute placement so the panel uses only CSS grid + saved sizes. */
function snapPanelToGrid(wrap) {
  const id = wrap.dataset.moduleId;
  if (!id) return;
  const all = readPanelSizes();
  if (all[id]) {
    delete all[id].x;
    delete all[id].y;
    if (Object.keys(all[id]).length === 0) delete all[id];
    localStorage.setItem(PANEL_SIZES_KEY, JSON.stringify(all));
  }
  wrap.dataset.zeeFloated = "";
  wrap.classList.remove("zee-panel--floated");
  wrap.style.position = "";
  wrap.style.left = "";
  wrap.style.top = "";
  wrap.style.transform = "";
  wrap.style.zIndex = "";
  wrap.style.gridColumn = "";
  wrap.style.gridRow = "";
  wrap.style.minHeight = "";
  wrap.style.willChange = "";
  applyStoredPanelLayout(wrap);
}

/**
 * After a header drag, keep the panel at the drop position for this session only (x/y not persisted).
 * @param {HTMLElement} grid
 * @param {HTMLElement} wrap
 * @param {number} x
 * @param {number} y
 */
function commitFloatedPanelPosition(grid, wrap, x, y) {
  const id = wrap.dataset.moduleId;
  if (!id) return;
  const maxX = Math.max(0, grid.scrollWidth - 48);
  const maxY = Math.max(0, grid.scrollHeight - 48);
  const nx = clamp(x, 0, maxX);
  const ny = clamp(y, 0, maxY);
  wrap.style.willChange = "";
  wrap.style.transform = "translate3d(0,0,0)";
  wrap.style.position = "absolute";
  wrap.style.gridColumn = "auto";
  wrap.style.gridRow = "auto";
  wrap.style.left = `${nx}px`;
  wrap.style.top = `${ny}px`;
  wrap.style.minHeight = "";
  let maxZ = 19;
  for (const el of grid.querySelectorAll(".zee-panel[data-zee-floated='1']")) {
    const z = parseInt(/** @type {HTMLElement} */ (el).style.zIndex, 10);
    if (Number.isFinite(z) && z > maxZ) maxZ = z;
  }
  wrap.style.zIndex = String(maxZ + 1);
  wrap.dataset.zeeFloated = "1";
  wrap.classList.add("zee-panel--floated");
  const prev = readPanelSizes()[id] || {};
  writePanelSize(id, {
    ...prev,
    w: wrap.offsetWidth,
    h: wrap.offsetHeight,
  });
  wrap.dataset.zeeUserSized = "1";
  wrap.classList.add("zee-panel--user-sized");
  applyStoredPanelSize(wrap);
}

/** @param {HTMLElement} wrap */
function clearAutoLayoutSizing(wrap) {
  wrap.style.width = "";
  wrap.style.maxWidth = "";
  wrap.style.minWidth = "";
  wrap.style.height = "";
  wrap.style.maxHeight = "";
  wrap.style.justifySelf = "";
  wrap.style.alignSelf = "";
}

/**
 * Invisible edge/corner strips: drag to set width/height; persisted in localStorage.
 * @param {HTMLElement} wrap
 */
function wireResize(wrap) {
  const id = wrap.dataset.moduleId;
  if (!id) return;

  applyStoredPanelLayout(wrap);

  const shell = document.createElement("div");
  shell.className = "zee-panel-resizers";
  shell.setAttribute("aria-hidden", "true");

  const edges = [
    ["n", "ns-resize"],
    ["e", "ew-resize"],
    ["s", "ns-resize"],
    ["w", "ew-resize"],
    ["ne", "nesw-resize"],
    ["se", "nwse-resize"],
    ["sw", "nesw-resize"],
    ["nw", "nwse-resize"],
  ];
  for (const [dir, cur] of edges) {
    const h = document.createElement("div");
    h.className = `zee-panel-resize zee-panel-resize--${dir}`;
    h.dataset.zeeEdge = dir;
    h.style.cursor = cur;
    h.title = "Drag edge to resize (double-click to reset)";
    shell.appendChild(h);
  }
  wrap.appendChild(shell);

  const grid = () => wrap.parentElement;
  const maxW = () => (grid() ? grid().clientWidth - 8 : window.innerWidth - 24);
  const maxH = () => window.innerHeight - 24;

  /** @type {{ edge: string; sx: number; sy: number; sw: number; sh: number; sl: number; st: number; prev: ZeePanelSize } | null} */
  let state = null;

  shell.addEventListener("dblclick", (ev) => {
    const t = ev.target;
    if (!(t instanceof HTMLElement) || !t.classList.contains("zee-panel-resize")) return;
    ev.preventDefault();
    ev.stopPropagation();
    const all = readPanelSizes();
    delete all[id];
    localStorage.setItem(PANEL_SIZES_KEY, JSON.stringify(all));
    wrap.dataset.zeeUserSized = "";
    wrap.dataset.zeeFloated = "";
    wrap.classList.remove("zee-panel--user-sized", "zee-panel--floated");
    wrap.style.position = "";
    wrap.style.left = "";
    wrap.style.top = "";
    wrap.style.transform = "";
    wrap.style.zIndex = "";
    wrap.style.gridColumn = "";
    wrap.style.gridRow = "";
    wrap.style.minHeight = "";
    clearAutoLayoutSizing(wrap);
  });

  function applyResizePreview(clientX, clientY) {
    if (!state) return;
    const dx = clientX - state.sx;
    const dy = clientY - state.sy;
    const e = state.edge;
    let w = state.sw;
    let h = state.sh;
    let jx = state.prev.jx;
    let jy = state.prev.jy;
    let mw = false;
    let mh = false;
    if (e.includes("e")) {
      w = state.sw + dx;
      jx = "start";
      mw = true;
    }
    if (e.includes("w")) {
      w = state.sw - dx;
      jx = "end";
      mw = true;
    }
    if (e.includes("s")) {
      h = state.sh + dy;
      jy = "start";
      mh = true;
    }
    if (e.includes("n")) {
      h = state.sh - dy;
      jy = "end";
      mh = true;
    }
    w = clamp(w, PANEL_MIN_W, maxW());
    h = clamp(h, PANEL_MIN_H, maxH());
    const fl = wrap.dataset.zeeFloated === "1";
    wrap.style.boxSizing = "border-box";
    if (mw) {
      if (!fl) {
        wrap.style.width = "100%";
        wrap.style.maxWidth = `min(100%, ${w}px)`;
        wrap.style.minWidth = "0";
        wrap.style.justifySelf = jx === "end" ? "end" : "start";
      } else {
        wrap.style.width = `${w}px`;
        wrap.style.maxWidth = `${w}px`;
        wrap.style.minWidth = `${Math.min(PANEL_MIN_W, w)}px`;
        wrap.style.justifySelf = "";
      }
    }
    if (mh) {
      wrap.style.height = `${h}px`;
      wrap.style.maxHeight = `${h}px`;
      if (!fl) wrap.style.alignSelf = jy === "end" ? "end" : "start";
      else wrap.style.alignSelf = "";
    }
    if (fl && state) {
      if (mw && e.includes("w")) {
        wrap.style.left = `${state.sl + state.sw - w}px`;
      }
      if (mh && e.includes("n")) {
        wrap.style.top = `${state.st + state.sh - h}px`;
      }
    }
  }

  function finishResize(clientX, clientY) {
    if (!state) return;
    const e = state.edge;
    const dx = clientX - state.sx;
    const dy = clientY - state.sy;
    let w = state.sw;
    let h = state.sh;
    let jx = state.prev.jx;
    let jy = state.prev.jy;
    let mw = false;
    let mh = false;
    if (e.includes("e")) {
      w = state.sw + dx;
      jx = "start";
      mw = true;
    }
    if (e.includes("w")) {
      w = state.sw - dx;
      jx = "end";
      mw = true;
    }
    if (e.includes("s")) {
      h = state.sh + dy;
      jy = "start";
      mh = true;
    }
    if (e.includes("n")) {
      h = state.sh - dy;
      jy = "end";
      mh = true;
    }
    w = clamp(w, PANEL_MIN_W, maxW());
    h = clamp(h, PANEL_MIN_H, maxH());
    const next = { ...state.prev };
    if (mw) {
      next.w = w;
      next.jx = jx;
    }
    if (mh) {
      next.h = h;
      next.jy = jy;
    }
    state = null;
    if (next.w != null || next.h != null) {
      writePanelSize(id, next);
      wrap.dataset.zeeUserSized = "1";
      wrap.classList.add("zee-panel--user-sized");
      applyStoredPanelSize(wrap);
    }
  }

  /** @param {PointerEvent} ev */
  function onDocMove(ev) {
    if (!state) return;
    applyResizePreview(ev.clientX, ev.clientY);
  }

  /** @param {PointerEvent} ev */
  function onDocUp(ev) {
    if (!state) return;
    document.removeEventListener("pointermove", onDocMove);
    document.removeEventListener("pointerup", onDocUp);
    document.removeEventListener("pointercancel", onDocUp);
    wrap.classList.remove("zee-panel--resizing");
    finishResize(ev.clientX, ev.clientY);
  }

  shell.addEventListener("pointerdown", (ev) => {
    const t = ev.target;
    if (!(t instanceof HTMLElement) || !t.classList.contains("zee-panel-resize")) return;
    if (ev.button !== 0) return;
    ev.preventDefault();
    ev.stopPropagation();
    const edge = String(t.dataset.zeeEdge || "");
    const r = wrap.getBoundingClientRect();
    const prev = readPanelSizes()[id] || {};
    const fl0 = wrap.dataset.zeeFloated === "1";
    const sl = fl0 ? parseFloat(wrap.style.left) || 0 : 0;
    const st = fl0 ? parseFloat(wrap.style.top) || 0 : 0;
    state = { edge, sx: ev.clientX, sy: ev.clientY, sw: r.width, sh: r.height, sl, st, prev: { ...prev } };
    wrap.classList.add("zee-panel--resizing");
    document.addEventListener("pointermove", onDocMove);
    document.addEventListener("pointerup", onDocUp);
    document.addEventListener("pointercancel", onDocUp);
  });
}

/** Drag header to float the panel (session only; reload snaps to CSS grid). Double-click title snaps back. */
function wireDrag(wrap) {
  const grid = wrap.parentElement;
  const head = wrap.querySelector(".zee-panel-head");
  if (!head || !grid) return;
  let startX = 0;
  let startY = 0;
  let origX = 0;
  let origY = 0;
  let lastDx = 0;
  let lastDy = 0;
  let dragging = false;

  function floatStackZ() {
    let maxZ = 19;
    for (const el of grid.querySelectorAll(".zee-panel[data-zee-floated='1']")) {
      const z = parseInt(/** @type {HTMLElement} */ (el).style.zIndex, 10);
      if (Number.isFinite(z) && z > maxZ) maxZ = z;
    }
    return maxZ + 1;
  }

  head.setAttribute(
    "title",
    "Drag title to move (this session; reload restores the default grid). Double-click title (not buttons) to snap back. Drag panel edges to resize."
  );

  head.addEventListener("dblclick", (e) => {
    if (e.target.closest("button")) return;
    e.preventDefault();
    snapPanelToGrid(wrap);
    stripOrphanAbsolutePanelStyles(wrap);
  });

  head.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    if (e.target.closest("button")) return;
    const rect = wrap.getBoundingClientRect();
    const pr = grid.getBoundingClientRect();
    if (wrap.dataset.zeeFloated === "1" && wrap.style.left && wrap.style.top) {
      const lx = parseFloat(wrap.style.left);
      const ly = parseFloat(wrap.style.top);
      origX = Number.isFinite(lx) ? lx : rect.left - pr.left + grid.scrollLeft;
      origY = Number.isFinite(ly) ? ly : rect.top - pr.top + grid.scrollTop;
    } else {
      origX = rect.left - pr.left + grid.scrollLeft;
      origY = rect.top - pr.top + grid.scrollTop;
    }
    wrap.style.left = `${origX}px`;
    wrap.style.top = `${origY}px`;
    wrap.style.width = `${rect.width}px`;
    wrap.style.minHeight = `${rect.height}px`;
    wrap.style.position = "absolute";
    wrap.style.gridColumn = "auto";
    wrap.style.gridRow = "auto";
    wrap.style.transform = "translate3d(0,0,0)";
    wrap.style.zIndex = String(floatStackZ() + 1);
    startX = e.clientX;
    startY = e.clientY;
    lastDx = 0;
    lastDy = 0;
    dragging = true;
    wrap.style.willChange = "transform";
    head.setPointerCapture(e.pointerId);
  });

  head.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    lastDx = e.clientX - startX;
    lastDy = e.clientY - startY;
    wrap.style.transform = `translate3d(${lastDx}px,${lastDy}px,0)`;
  });

  function endDrag(e) {
    if (!dragging) return;
    dragging = false;
    try {
      head.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    const dx = Number.isFinite(e.clientX) ? e.clientX - startX : lastDx;
    const dy = Number.isFinite(e.clientY) ? e.clientY - startY : lastDy;
    commitFloatedPanelPosition(grid, wrap, origX + dx, origY + dy);
  }

  head.addEventListener("pointerup", endDrag);
  head.addEventListener("pointercancel", (e) => {
    if (!dragging) return;
    dragging = false;
    wrap.style.willChange = "";
    try {
      head.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    commitFloatedPanelPosition(grid, wrap, origX + lastDx, origY + lastDy);
  });
}

/** @param {HTMLElement} wrap @param {string} modId @param {string} modTitle */
function wireDrilldown(wrap, modId, modTitle) {
  const body = /** @type {HTMLElement | null} */ (wrap.querySelector(".zee-panel-body"));
  const btn = /** @type {HTMLButtonElement | null} */ (wrap.querySelector(".zee-panel-expand"));
  if (!body || !btn) return;

  const closeExisting = () => {
    if (typeof activeDrilldownClose === "function") activeDrilldownClose();
    activeDrilldownClose = null;
  };

  const open = () => {
    closeExisting();
    const modal = document.createElement("div");
    modal.className = "zee-module-modal";
    modal.innerHTML = `
      <div class="zee-module-modal-card">
        <div class="zee-module-modal-head">
          <div class="zee-sym">${escapeHtml(modTitle)}</div>
          <button type="button" class="zee-btn zee-btn-sm" data-action="close">Close</button>
        </div>
        <div class="zee-module-modal-body"></div>
      </div>
    `;
    const card = /** @type {HTMLElement | null} */ (modal.querySelector(".zee-module-modal-card"));
    const mount = /** @type {HTMLElement | null} */ (modal.querySelector(".zee-module-modal-body"));
    const rect = wrap.getBoundingClientRect();
    const dx = rect.left + rect.width / 2 - window.innerWidth / 2;
    const dy = rect.top + rect.height / 2 - window.innerHeight / 2;
    if (card) {
      card.style.setProperty("--from-x", `${dx}px`);
      card.style.setProperty("--from-y", `${dy}px`);
    }
    const placeholder = document.createElement("div");
    placeholder.className = "zee-panel-placeholder";
    body.parentNode?.insertBefore(placeholder, body);
    mount?.appendChild(body);
    document.body.appendChild(modal);
    requestAnimationFrame(() => modal.classList.add("zee-module-modal-open"));

    const close = () => {
      modal.classList.remove("zee-module-modal-open");
      window.setTimeout(() => {
        placeholder.parentNode?.insertBefore(body, placeholder);
        placeholder.remove();
        modal.remove();
      }, 180);
      if (activeDrilldownClose === close) activeDrilldownClose = null;
      bus.emit("spotlight:closed", { target: modId });
    };

    modal.querySelector("[data-action='close']")?.addEventListener("click", close);
    modal.addEventListener("click", (ev) => {
      if (ev.target === modal) close();
    });
    activeDrilldownClose = close;
  };

  btn.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    open();
  });

  const offClose = bus.on("spotlight:close", ({ target }) => {
    if (target === "all" || target === modId) closeExisting();
  });

  wrap.addEventListener("remove", () => offClose());
}
