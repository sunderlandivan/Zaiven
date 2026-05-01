export const gmailModule = {
  id: "gmail",
  title: "Gmail — inbox",
  mount(el) {
    el.innerHTML = `
      <div class="zee-gmail-toolbar">
        <button type="button" class="zee-btn zee-btn-sm" id="zee-gmail-connect">Connect</button>
        <button type="button" class="zee-btn zee-btn-sm" id="zee-gmail-refresh">Refresh</button>
      </div>
      <div class="zee-gmail-list" id="zee-gmail-list"></div>
    `;

    const list = el.querySelector("#zee-gmail-list");
    let messages = [];

    const modal = document.createElement("div");
    modal.className = "zee-mail-modal zee-panel-hidden";
    modal.innerHTML = `
      <div class="zee-mail-modal-card" id="zee-mail-modal-card">
        <div class="zee-mail-modal-head">
          <div class="zee-sym" id="zee-mail-title">Email</div>
          <button type="button" class="zee-btn zee-btn-sm" id="zee-mail-close">Close</button>
        </div>
        <div class="zee-mail-meta" id="zee-mail-meta"></div>
        <div class="zee-mail-body" id="zee-mail-body"></div>
        <div class="zee-mail-actions">
          <button type="button" class="zee-btn zee-btn-sm" id="zee-mail-open-gmail">Open in Gmail</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const closeModal = () => {
      modal.classList.remove("zee-stock-modal-open");
      setTimeout(() => modal.classList.add("zee-panel-hidden"), 180);
    };

    const openModal = (m, fromRect) => {
      const title = modal.querySelector("#zee-mail-title");
      const meta = modal.querySelector("#zee-mail-meta");
      const body = modal.querySelector("#zee-mail-body");
      if (title) title.textContent = m.subject || "Email";
      if (meta) meta.innerHTML = `<div>${escapeHtml(m.from || "")}</div><div>${escapeHtml(m.date || "")}</div>`;
      if (body) body.textContent = m.preview || m.snippet || "(no preview)";
      const card = modal.querySelector("#zee-mail-modal-card");
      const dx = fromRect ? fromRect.left + fromRect.width / 2 - window.innerWidth / 2 : 0;
      const dy = fromRect ? fromRect.top + fromRect.height / 2 - window.innerHeight / 2 : 0;
      card?.style.setProperty("--from-x", `${dx}px`);
      card?.style.setProperty("--from-y", `${dy}px`);
      modal.classList.remove("zee-panel-hidden");
      requestAnimationFrame(() => modal.classList.add("zee-stock-modal-open"));
      const openBtn = modal.querySelector("#zee-mail-open-gmail");
      openBtn?.addEventListener(
        "click",
        () => {
          const url = String(m.gmailUrl || "").trim();
          if (url) window.open(url, "_blank", "noopener,noreferrer");
        },
        { once: true }
      );
    };

    const refresh = async () => {
      if (!list) return;
      list.innerHTML = `<div class="zee-muted">Loading…</div>`;
      try {
        const res = await fetch("/api/zee/gmail/messages?max=10");
        const j = await res.json();
        if (!j.ok) throw new Error(j.error);
        messages = j.data?.messages || [];
        if (!messages.length) {
          list.innerHTML = `<div class="zee-muted">No messages.</div>`;
          return;
        }
        list.innerHTML = messages
          .map(
            (m, i) => `
          <article class="zee-mail" data-idx="${i + 1}">
            <div class="zee-mail-sub">${escapeHtml(m.subject)}</div>
            <div class="zee-mail-from">${escapeHtml(m.from)}</div>
            <div class="zee-mail-snip">${escapeHtml(m.snippet || "").slice(0, 140)}</div>
          </article>`
          )
          .join("");

        list.querySelectorAll(".zee-mail").forEach((item) => {
          item.addEventListener("click", () => {
            const idx = Number(item.getAttribute("data-idx")) - 1;
            const msg = messages[idx];
            if (!msg) return;
            openModal(msg, item.getBoundingClientRect());
          });
        });
      } catch (e) {
        list.innerHTML = `<div class="zee-err">${escapeHtml(String(e.message || e))}</div>`;
      }
    };

    modal.querySelector("#zee-mail-close")?.addEventListener("click", closeModal);
    modal.addEventListener("click", (ev) => {
      if (ev.target === modal) closeModal();
    });

    el.querySelector("#zee-gmail-connect")?.addEventListener("click", async () => {
      const res = await fetch("/api/zee/gmail/auth/start");
      const j = await res.json();
      if (j.ok && j.authUrl) window.open(j.authUrl, "_blank", "noopener,noreferrer");
    });
    el.querySelector("#zee-gmail-refresh")?.addEventListener("click", refresh);

    const params = new URLSearchParams(location.search);
    if (params.get("gmail") === "connected") refresh();
    refresh();
    const id = window.setInterval(refresh, 180_000);

    return {
      destroy() {
        modal.remove();
        window.clearInterval(id);
      },
    };
  },
};

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
