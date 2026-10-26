function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function ensureRingModal() {
  let modal = document.getElementById("zee-ring-modal");
  if (modal) return modal;
  modal = document.createElement("div");
  modal.id = "zee-ring-modal";
  modal.className = "zee-stock-modal zee-panel-hidden";
  modal.innerHTML = `
    <div class="zee-stock-modal-card zee-ring-modal-card">
      <div class="zee-stock-modal-head">
        <div class="zee-sym">Ring Camera</div>
        <button type="button" class="zee-btn zee-btn-sm" data-action="close">Close</button>
      </div>
      <div class="zee-ring-modal-body" id="zee-ring-modal-body"></div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelector('[data-action="close"]')?.addEventListener("click", () => {
    modal.classList.remove("zee-stock-modal-open");
    setTimeout(() => modal.classList.add("zee-panel-hidden"), 180);
  });
  modal.addEventListener("click", (ev) => {
    if (ev.target === modal) {
      modal.classList.remove("zee-stock-modal-open");
      setTimeout(() => modal.classList.add("zee-panel-hidden"), 180);
    }
  });
  return modal;
}

function openRingModal(contentHtml) {
  const modal = ensureRingModal();
  const body = modal.querySelector("#zee-ring-modal-body");
  if (body) body.innerHTML = contentHtml;
  modal.classList.remove("zee-panel-hidden");
  requestAnimationFrame(() => modal.classList.add("zee-stock-modal-open"));
}

async function fetchRingStatus() {
  const res = await fetch("/api/zee/ring/status");
  return res.json();
}

export const ringModule = {
  id: "ring",
  title: "Ring",
  mount(el) {
    el.innerHTML = `
      <div class="zee-ring">
        <div class="zee-ring-toolbar">
          <button type="button" class="zee-btn zee-btn-xs" id="zee-ring-refresh">Refresh</button>
          <span class="zee-muted" id="zee-ring-status">Checking...</span>
        </div>
        <div class="zee-ring-preview" id="zee-ring-preview"></div>
        <div class="zee-ring-actions">
          <button type="button" class="zee-btn zee-btn-xs" id="zee-ring-open-live">Open live</button>
          <button type="button" class="zee-btn zee-btn-xs" id="zee-ring-open-modal">Drill-down</button>
        </div>
      </div>
    `;
    const statusEl = el.querySelector("#zee-ring-status");
    const previewEl = el.querySelector("#zee-ring-preview");
    let snapshotUrl = "";
    let streamUrl = "";

    const render = async () => {
      try {
        const j = await fetchRingStatus();
        if (!j.ok) throw new Error(j.error || "Ring status failed");
        snapshotUrl = String(j.snapshotUrl || "").trim();
        streamUrl = String(j.streamUrl || "").trim();
        if (statusEl) {
          statusEl.textContent = j.lastRingAt
            ? `Last ring: ${new Date(Number(j.lastRingAt)).toLocaleTimeString()}`
            : "No ring events yet";
        }
        if (previewEl) {
          previewEl.innerHTML = snapshotUrl
            ? `<img src="${snapshotUrl}" alt="Ring snapshot" class="zee-ring-image" />`
            : `<div class="zee-muted">Set ZEE_RING_SNAPSHOT_URL and/or ZEE_RING_STREAM_URL.</div>`;
        }
      } catch (e) {
        if (statusEl) statusEl.textContent = String(e.message || e);
      }
    };

    el.querySelector("#zee-ring-refresh")?.addEventListener("click", render);
    el.querySelector("#zee-ring-open-live")?.addEventListener("click", () => {
      if (streamUrl) window.open(streamUrl, "_blank", "noopener");
    });
    el.querySelector("#zee-ring-open-modal")?.addEventListener("click", () => {
      const content = streamUrl
        ? `<iframe src="${streamUrl}" class="zee-ring-iframe" allow="autoplay; fullscreen"></iframe>`
        : snapshotUrl
          ? `<img src="${snapshotUrl}" alt="Ring snapshot" class="zee-ring-image zee-ring-image--large" />`
          : `<div class="zee-muted">Configure Ring URLs in environment variables.</div>`;
      openRingModal(content);
    });

    window.addEventListener("zee:ring-open", () => {
      el.querySelector("#zee-ring-open-modal")?.dispatchEvent(new Event("click"));
    });

    render();
    const id = window.setInterval(render, 30000);
    return { destroy: () => window.clearInterval(id) };
  },
};
