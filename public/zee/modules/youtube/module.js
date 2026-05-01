import { bus } from "../../core/bus.js";

let ytState = { videos: [] };

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function toEmbed(urlOrId) {
  const s = String(urlOrId || "").trim();
  if (!s) return "";
  if (/^[A-Za-z0-9_-]{8,}$/.test(s)) {
    return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(s)}?autoplay=1&enablejsapi=1&origin=${encodeURIComponent(location.origin)}`;
  }
  const m = s.match(/[?&]v=([A-Za-z0-9_-]{8,})/) || s.match(/youtu\.be\/([A-Za-z0-9_-]{8,})/);
  const id = m ? m[1] : "";
  return id
    ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1&enablejsapi=1&origin=${encodeURIComponent(location.origin)}`
    : "";
}

export const youtubeModule = {
  id: "youtube",
  title: "Youtube videos",
  mount(el) {
    el.innerHTML = `
      <div class="zee-yt" id="zee-yt-root"></div>
    `;
    const root = el.querySelector("#zee-yt-root");
    const hostPanel = el.closest(".zee-panel");
    const modal = document.createElement("div");
    modal.className = "zee-yt-modal zee-panel-hidden";
    modal.innerHTML = `
      <div class="zee-yt-modal-card" id="zee-yt-modal-card">
        <div class="zee-yt-modal-head">
          <div class="zee-sym" id="zee-yt-title">Youtube video</div>
          <button type="button" class="zee-btn zee-btn-sm" id="zee-yt-close">Close</button>
        </div>
        <div class="zee-yt-player-wrap">
          <iframe id="zee-yt-frame" class="zee-yt-frame" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const closeModal = () => {
      modal.classList.remove("zee-stock-modal-open");
      window.setTimeout(() => {
        const frame = /** @type {HTMLIFrameElement | null} */ (modal.querySelector("#zee-yt-frame"));
        if (frame) frame.src = "";
        modal.classList.add("zee-panel-hidden");
      }, 180);
    };

    const pauseVideo = () => {
      const frame = /** @type {HTMLIFrameElement | null} */ (modal.querySelector("#zee-yt-frame"));
      if (!frame?.contentWindow) return { ok: false, error: "video not open" };
      frame.contentWindow.postMessage(
        JSON.stringify({
          event: "command",
          func: "pauseVideo",
          args: [],
        }),
        "*"
      );
      return { ok: true };
    };

    const openVideo = (video, fromRect) => {
      const frame = /** @type {HTMLIFrameElement | null} */ (modal.querySelector("#zee-yt-frame"));
      const title = modal.querySelector("#zee-yt-title");
      const card = modal.querySelector("#zee-yt-modal-card");
      const embed = toEmbed(video?.url || video?.id);
      if (!embed || !frame) return;
      if (title) title.textContent = String(video.title || "Youtube video");
      frame.src = embed;
      const dx = fromRect ? fromRect.left + fromRect.width / 2 - window.innerWidth / 2 : 0;
      const dy = fromRect ? fromRect.top + fromRect.height / 2 - window.innerHeight / 2 : 0;
      card?.style.setProperty("--from-x", `${dx}px`);
      card?.style.setProperty("--from-y", `${dy}px`);
      modal.classList.remove("zee-panel-hidden");
      requestAnimationFrame(() => modal.classList.add("zee-stock-modal-open"));
    };

    const refresh = async () => {
      if (!root) return;
      root.innerHTML = `<div class="zee-muted">Loading videos...</div>`;
      try {
        const res = await fetch("/api/zee/youtube/videos");
        const j = await res.json();
        if (!j.ok) throw new Error(j.error || "youtube feed failed");
        ytState.videos = Array.isArray(j.data?.videos) ? j.data.videos : [];
        const rows = ytState.videos
          .slice(0, 8)
          .map(
            (v, i) => `
              <button type="button" class="zee-yt-card" data-yt-idx="${i}">
                <img class="zee-yt-thumb" src="${escapeHtml(v.thumbnail || "")}" alt="${escapeHtml(v.title || "video")}" loading="lazy" />
                <span class="zee-yt-caption">${escapeHtml(v.title || "")}</span>
              </button>`
          )
          .join("");
        root.innerHTML = rows || `<div class="zee-muted">No videos available right now.</div>`;
        root.querySelectorAll("[data-yt-idx]").forEach((node) => {
          node.addEventListener("click", () => {
            const idx = Number(node.getAttribute("data-yt-idx"));
            const video = ytState.videos[idx];
            if (video) openVideo(video, node.getBoundingClientRect());
          });
        });
      } catch (e) {
        root.innerHTML = `<div class="zee-err">${escapeHtml(String(e.message || e))}</div>`;
      }
    };

    const offOpen = bus.on("youtube:open", ({ index }) => {
      const idx = Math.max(1, Number(index || 1)) - 1;
      const video = ytState.videos[idx];
      if (!video) return { ok: false, error: "video not found" };
      openVideo(video, hostPanel?.getBoundingClientRect());
      return { ok: true, title: video.title };
    });
    const offClose = bus.on("spotlight:close", ({ target }) => {
      if (target === "all" || target === "youtube") closeModal();
    });
    const offPause = bus.on("youtube:pause", () => pauseVideo());
    modal.querySelector("#zee-yt-close")?.addEventListener("click", closeModal);
    modal.addEventListener("click", (ev) => {
      if (ev.target === modal) closeModal();
    });

    refresh();
    const id = window.setInterval(refresh, 180_000);

    return {
      destroy() {
        offOpen();
        offClose();
        offPause();
        window.clearInterval(id);
        modal.remove();
      },
    };
  },
};
