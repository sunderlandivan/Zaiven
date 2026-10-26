function fmtPct(v) {
  return Number.isFinite(Number(v)) ? `${Number(v).toFixed(1)}%` : "—";
}

function fmtBytes(n) {
  const x = Number(n);
  if (!Number.isFinite(x) || x <= 0) return "—";
  const gb = x / (1024 ** 3);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = x / (1024 ** 2);
  return `${mb.toFixed(0)} MB`;
}

function fmtUptime(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${m}m`;
}

function drawSpark(canvas, series) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "rgba(6,18,30,0.7)";
  ctx.fillRect(0, 0, w, h);
  const vals = (series || []).filter(Number.isFinite);
  if (vals.length < 2) return;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  ctx.strokeStyle = "rgba(62,214,255,0.95)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (let i = 0; i < vals.length; i++) {
    const x = (i / (vals.length - 1)) * (w - 1);
    const n = max === min ? 0.5 : (vals[i] - min) / (max - min);
    const y = (1 - n) * (h - 2) + 1;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

export const systemModule = {
  id: "system",
  title: "System performance",
  mount(el) {
    el.innerHTML = `
      <div class="zee-system" id="zee-system-root">
        <div class="zee-system-row"><span>CPU Usage</span><strong id="zee-sys-cpu">—</strong><canvas class="zee-sys-spark" id="zee-sys-cpu-cv" width="82" height="18"></canvas></div>
        <div class="zee-system-row"><span>GPU Usage</span><strong id="zee-sys-gpu">—</strong><canvas class="zee-sys-spark" id="zee-sys-gpu-cv" width="82" height="18"></canvas></div>
        <div class="zee-system-row"><span>Memory</span><strong id="zee-sys-mem">—</strong><canvas class="zee-sys-spark" id="zee-sys-mem-cv" width="82" height="18"></canvas></div>
        <div class="zee-system-row"><span>Disk Used</span><strong id="zee-sys-disk">—</strong><canvas class="zee-sys-spark" id="zee-sys-disk-cv" width="82" height="18"></canvas></div>
        <div class="zee-system-row"><span>CPU Temp</span><strong id="zee-sys-cput">—</strong><canvas class="zee-sys-spark" id="zee-sys-cput-cv" width="82" height="18"></canvas></div>
        <div class="zee-system-row"><span>GPU Temp</span><strong id="zee-sys-gput">—</strong><canvas class="zee-sys-spark" id="zee-sys-gput-cv" width="82" height="18"></canvas></div>
        <div class="zee-system-row"><span>Uptime</span><strong id="zee-sys-up">—</strong></div>
      </div>
    `;
    const hist = {
      cpu: [],
      gpu: [],
      mem: [],
      disk: [],
      cput: [],
      gput: [],
    };
    const push = (k, v) => {
      if (!Number.isFinite(Number(v))) return;
      hist[k].push(Number(v));
      if (hist[k].length > 28) hist[k].shift();
    };
    const update = async () => {
      try {
        const res = await fetch("/api/zee/system/stats");
        const j = await res.json();
        if (!j.ok) throw new Error(j.error || "system stats failed");
        const d = j.data || {};
        const cpu = el.querySelector("#zee-sys-cpu");
        const gpu = el.querySelector("#zee-sys-gpu");
        const mem = el.querySelector("#zee-sys-mem");
        const disk = el.querySelector("#zee-sys-disk");
        const cput = el.querySelector("#zee-sys-cput");
        const gput = el.querySelector("#zee-sys-gput");
        const up = el.querySelector("#zee-sys-up");
        if (cpu) cpu.textContent = fmtPct(d.cpuUsagePct);
        push("cpu", d.cpuUsagePct);
        if (gpu) gpu.textContent = fmtPct(d.gpuUsagePct);
        push("gpu", d.gpuUsagePct);
        if (mem) mem.textContent = `${fmtPct(d.memoryUsedPct)} (${fmtBytes(d.memoryUsedBytes)} / ${fmtBytes(d.memoryTotalBytes)})`;
        push("mem", d.memoryUsedPct);
        if (disk) disk.textContent = fmtPct(d.disk?.usedPct);
        push("disk", d.disk?.usedPct);
        if (cput) cput.textContent = Number.isFinite(Number(d.cpuTempC)) ? `${Number(d.cpuTempC).toFixed(1)} C` : "—";
        push("cput", d.cpuTempC);
        if (gput) gput.textContent = Number.isFinite(Number(d.gpuTempC)) ? `${Number(d.gpuTempC).toFixed(1)} C` : "—";
        push("gput", d.gpuTempC);
        if (up) up.textContent = fmtUptime(d.uptimeSec);
        drawSpark(/** @type {HTMLCanvasElement} */ (el.querySelector("#zee-sys-cpu-cv")), hist.cpu);
        drawSpark(/** @type {HTMLCanvasElement} */ (el.querySelector("#zee-sys-gpu-cv")), hist.gpu);
        drawSpark(/** @type {HTMLCanvasElement} */ (el.querySelector("#zee-sys-mem-cv")), hist.mem);
        drawSpark(/** @type {HTMLCanvasElement} */ (el.querySelector("#zee-sys-disk-cv")), hist.disk);
        drawSpark(/** @type {HTMLCanvasElement} */ (el.querySelector("#zee-sys-cput-cv")), hist.cput);
        drawSpark(/** @type {HTMLCanvasElement} */ (el.querySelector("#zee-sys-gput-cv")), hist.gput);
      } catch {
        // keep prior values
      }
    };
    update();
    const id = window.setInterval(update, 5000);
    return { destroy: () => window.clearInterval(id) };
  },
};
