import { bus } from "../../core/bus.js";

/** @type {{ items: { rel: string; title: string }[]; queue: number; current: number } | null} */
let state = { items: [], queue: 0, current: -1 };

function audioEl() {
  return /** @type {HTMLAudioElement | null} */ (document.getElementById("zee-music-audio"));
}

function createVisualizer(canvas) {
  const audio = audioEl();
  if (!audio || !canvas) return { destroy() {} };
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return { destroy() {} };
  const ctx = new AudioCtx();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.86;
  const src = ctx.createMediaElementSource(audio);
  src.connect(analyser);
  analyser.connect(ctx.destination);
  const bins = new Uint8Array(analyser.frequencyBinCount);
  const g = canvas.getContext("2d");
  let raf = 0;

  const draw = () => {
    if (!g) return;
    const w = canvas.clientWidth || 300;
    const h = canvas.clientHeight || 72;
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    analyser.getByteFrequencyData(bins);
    g.clearRect(0, 0, w, h);
    g.fillStyle = "rgba(5, 18, 34, 0.65)";
    g.fillRect(0, 0, w, h);
    const bars = 60;
    const bw = Math.max(2, Math.floor(w / bars) - 1);
    for (let i = 0; i < bars; i += 1) {
      const bi = Math.floor((i / bars) * bins.length);
      const v = bins[bi] / 255;
      const bh = Math.max(2, Math.floor(v * (h - 12)));
      const x = i * (bw + 1);
      const y = h - bh - 2;
      const a = 0.35 + v * 0.6;
      g.fillStyle = `rgba(34, 227, 255, ${a.toFixed(3)})`;
      g.fillRect(x, y, bw, bh);
    }
    raf = window.requestAnimationFrame(draw);
  };

  const onPlay = () => {
    ctx.resume().catch(() => {});
    if (!raf) draw();
  };
  const onPause = () => {
    if (raf) window.cancelAnimationFrame(raf);
    raf = 0;
  };
  audio.addEventListener("play", onPlay);
  audio.addEventListener("pause", onPause);
  audio.addEventListener("ended", onPause);
  if (!audio.paused) onPlay();

  return {
    destroy() {
      onPause();
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onPause);
      src.disconnect();
      analyser.disconnect();
      ctx.close().catch(() => {});
    },
  };
}

export const musicModule = {
  id: "music",
  title: "Studio — music",
  mount(el) {
    el.innerHTML = `
      <div class="zee-music">
        <div class="zee-music-row">
          <input type="search" id="zee-music-filter" class="zee-input" placeholder="Filter library…" />
          <button type="button" class="zee-btn zee-btn-sm" id="zee-music-scan">Rescan</button>
        </div>
        <ul class="zee-music-list" id="zee-music-list"></ul>
        <div class="zee-music-transport">
          <button type="button" class="zee-btn zee-btn-sm" id="zee-music-prev">Prev</button>
          <button type="button" class="zee-btn zee-btn-sm" id="zee-music-play">Play</button>
          <button type="button" class="zee-btn zee-btn-sm" id="zee-music-pause">Pause</button>
          <button type="button" class="zee-btn zee-btn-sm" id="zee-music-next">Next</button>
          <label class="zee-vol"><span>Vol</span><input type="range" id="zee-music-vol" min="0" max="1" step="0.05" value="0.8" /></label>
        </div>
        <div class="zee-music-monitor">
          <canvas id="zee-music-wave" class="zee-music-wave" width="320" height="72"></canvas>
        </div>
        <div class="zee-music-now" id="zee-music-now">—</div>
      </div>
    `;
    const listEl = el.querySelector("#zee-music-list");
    const nowEl = el.querySelector("#zee-music-now");
    const filterEl = el.querySelector("#zee-music-filter");
    const waveCanvas = /** @type {HTMLCanvasElement | null} */ (el.querySelector("#zee-music-wave"));
    const viz = createVisualizer(waveCanvas);

    const loadLib = async () => {
      const res = await fetch("/api/zee/music/library?refresh=0");
      const j = await res.json();
      if (!j.ok) throw new Error(j.error);
      state.items = (j.items || []).map((x) => ({ rel: x.rel, title: x.title }));
      renderList("");
    };

    const renderList = (q) => {
      if (!listEl) return;
      const qq = String(q || "").toLowerCase();
      const rows = state.items
        .map((x, i) => ({ x, i }))
        .filter(({ x }) => !qq || x.rel.toLowerCase().includes(qq) || x.title.toLowerCase().includes(qq))
        .slice(0, 80);
      listEl.innerHTML = rows
        .map(
          ({ x, i }) =>
            `<li><button type="button" class="zee-linkbtn" data-idx="${i}">${escapeHtml(x.title)}</button><span class="zee-src">${escapeHtml(
              x.rel
            )}</span></li>`
        )
        .join("");
      listEl.querySelectorAll("button[data-idx]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const idx = Number(btn.getAttribute("data-idx"));
          playIndex(idx);
        });
      });
    };

    const playIndex = (idx) => {
      const item = state.items[idx];
      if (!item) return;
      state.current = idx;
      const a = audioEl();
      if (!a) return;
      a.src = `/api/zee/music/stream?rel=${encodeURIComponent(item.rel)}`;
      a.play().catch(() => {});
      if (nowEl) nowEl.textContent = item.title;
    };

    const findPlay = (query) => {
      const q = String(query || "").toLowerCase().trim();
      if (!q) return { ok: false, error: "empty query" };
      const idx = state.items.findIndex(
        (x) => x.title.toLowerCase().includes(q) || x.rel.toLowerCase().includes(q.replace(/\\/g, "/"))
      );
      if (idx < 0) return { ok: false, error: "no match" };
      playIndex(idx);
      return { ok: true, title: state.items[idx].title };
    };

    filterEl?.addEventListener("input", () => renderList(/** @type {HTMLInputElement} */ (filterEl).value));
    el.querySelector("#zee-music-scan")?.addEventListener("click", () => {
      fetch("/api/zee/music/library?refresh=1")
        .then((r) => r.json())
        .then((j) => {
          if (j.ok) {
            state.items = (j.items || []).map((x) => ({ rel: x.rel, title: x.title }));
            renderList(/** @type {HTMLInputElement} */ (filterEl).value || "");
          }
        })
        .catch(() => {});
    });
    el.querySelector("#zee-music-play")?.addEventListener("click", () => {
      const a = audioEl();
      if (a?.src) a.play().catch(() => {});
      else if (state.items[0]) playIndex(0);
    });
    el.querySelector("#zee-music-pause")?.addEventListener("click", () => audioEl()?.pause());
    el.querySelector("#zee-music-next")?.addEventListener("click", () => {
      if (state.current < 0) playIndex(0);
      else playIndex((state.current + 1) % Math.max(1, state.items.length));
    });
    el.querySelector("#zee-music-prev")?.addEventListener("click", () => {
      if (state.current < 0) playIndex(Math.max(0, state.items.length - 1));
      else playIndex((state.current - 1 + state.items.length) % state.items.length);
    });
    el.querySelector("#zee-music-vol")?.addEventListener("input", (e) => {
      const a = audioEl();
      if (a) a.volume = Number(/** @type {HTMLInputElement} */ (e.target).value);
    });

    const off = bus.on("music:play", ({ query, reply }) => {
      const result = findPlay(query);
      if (typeof reply === "function") reply(result);
      return result;
    });
    const offVol = bus.on("music:volume", ({ level }) => {
      const a = audioEl();
      if (a) a.volume = Math.max(0, Math.min(1, Number(level)));
      const r = el.querySelector("#zee-music-vol");
      if (r) /** @type {HTMLInputElement} */ (r).value = String(a?.volume ?? 0.8);
    });
    const offPause = bus.on("music:pause", () => audioEl()?.pause());
    const offNext = bus.on("music:next", () => {
      if (state.current < 0) playIndex(0);
      else playIndex((state.current + 1) % Math.max(1, state.items.length));
    });

    loadLib().catch((e) => {
      if (listEl) listEl.innerHTML = `<li class="zee-err">${escapeHtml(e.message)}</li>`;
    });

    return {
      destroy() {
        off();
        offVol();
        offPause();
        offNext();
        viz.destroy();
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
