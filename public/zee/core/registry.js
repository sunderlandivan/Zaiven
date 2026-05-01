import { bus } from "./bus.js";

/** @typedef {{ id: string, title: string, defaultHidden?: boolean, mount: (el: HTMLElement) => { destroy?: () => void } } } ZeeModule */

/** @type {Map<string, ZeeModule>} */
const modules = new Map();

/** @type {Map<string, { el: HTMLElement, api?: ReturnType<ZeeModule['mount']> }>} */
const instances = new Map();
let activeDrilldownClose = null;

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
    for (const mod of modules.values()) {
      const wrap = document.createElement("section");
      wrap.className = "zee-panel";
      wrap.dataset.moduleId = mod.id;
      if (mod.defaultHidden) wrap.classList.add("zee-panel-hidden");
      wrap.innerHTML = `
        <header class="zee-panel-head">
          <span class="zee-panel-title">${escapeHtml(mod.title)}</span>
          <span class="zee-panel-head-actions">
            <button type="button" class="zee-panel-expand" title="Drill down">⤢</button>
            <span class="zee-panel-drag" title="Drag">⠿</span>
          </span>
        </header>
        <div class="zee-panel-body" id="zee-panel-body-${mod.id}"></div>
      `;
      grid.appendChild(wrap);
      const body = wrap.querySelector(`#zee-panel-body-${mod.id}`);
      const api = mod.mount(/** @type {HTMLElement} */ (body));
      instances.set(mod.id, { el: wrap, api });
      wireDrag(wrap);
      wireDrilldown(wrap, mod.id, mod.title);
    }
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
};

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** @param {HTMLElement} wrap */
function wireDrag(wrap) {
  const grid = wrap.parentElement;
  const head = wrap.querySelector(".zee-panel-head");
  if (!head || !grid) return;
  let startX = 0;
  let startY = 0;
  let origX = 0;
  let origY = 0;
  let dragging = false;

  head.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const rect = wrap.getBoundingClientRect();
    const pr = grid.getBoundingClientRect();
    origX = rect.left - pr.left + grid.scrollLeft;
    origY = rect.top - pr.top + grid.scrollTop;
    wrap.style.left = `${origX}px`;
    wrap.style.top = `${origY}px`;
    wrap.style.width = `${rect.width}px`;
    wrap.style.minHeight = `${rect.height}px`;
    wrap.style.position = "absolute";
    wrap.style.gridColumn = "auto";
    wrap.style.gridRow = "auto";
    wrap.style.transform = "translate3d(0,0,0)";
    wrap.style.zIndex = "5";
    startX = e.clientX;
    startY = e.clientY;
    dragging = true;
    wrap.style.willChange = "transform";
    head.setPointerCapture(e.pointerId);
  });

  head.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    wrap.style.transform = `translate3d(${dx}px,${dy}px,0)`;
  });

  function endDrag(e) {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    wrap.style.left = `${origX + dx}px`;
    wrap.style.top = `${origY + dy}px`;
    wrap.style.transform = "translate3d(0,0,0)";
    dragging = false;
    try {
      head.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    wrap.style.willChange = "";
  }

  head.addEventListener("pointerup", endDrag);
  head.addEventListener("pointercancel", () => {
    dragging = false;
    wrap.style.willChange = "";
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
