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

export const systemModule = {
  id: "system",
  title: "System performance",
  mount(el) {
    el.innerHTML = `
      <div class="zee-system" id="zee-system-root">
        <div class="zee-system-row"><span>CPU Usage</span><strong id="zee-sys-cpu">—</strong></div>
        <div class="zee-system-row"><span>GPU Usage</span><strong id="zee-sys-gpu">—</strong></div>
        <div class="zee-system-row"><span>Memory</span><strong id="zee-sys-mem">—</strong></div>
        <div class="zee-system-row"><span>Disk Used</span><strong id="zee-sys-disk">—</strong></div>
        <div class="zee-system-row"><span>CPU Temp</span><strong id="zee-sys-cput">—</strong></div>
        <div class="zee-system-row"><span>GPU Temp</span><strong id="zee-sys-gput">—</strong></div>
        <div class="zee-system-row"><span>Uptime</span><strong id="zee-sys-up">—</strong></div>
      </div>
    `;
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
        if (gpu) gpu.textContent = fmtPct(d.gpuUsagePct);
        if (mem) mem.textContent = `${fmtPct(d.memoryUsedPct)} (${fmtBytes(d.memoryUsedBytes)} / ${fmtBytes(d.memoryTotalBytes)})`;
        if (disk) disk.textContent = fmtPct(d.disk?.usedPct);
        if (cput) cput.textContent = Number.isFinite(Number(d.cpuTempC)) ? `${Number(d.cpuTempC).toFixed(1)} C` : "—";
        if (gput) gput.textContent = Number.isFinite(Number(d.gpuTempC)) ? `${Number(d.gpuTempC).toFixed(1)} C` : "—";
        if (up) up.textContent = fmtUptime(d.uptimeSec);
      } catch {
        // keep prior values
      }
    };
    update();
    const id = window.setInterval(update, 5000);
    return { destroy: () => window.clearInterval(id) };
  },
};
