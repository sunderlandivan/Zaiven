import os from "os";
import path from "path";
import { statfsSync } from "fs";

/** @type {{ idle: number, total: number, at: number } | null} */
let cpuSample = null;

function sampleCpu() {
  const cpus = os.cpus() || [];
  let idle = 0;
  let total = 0;
  for (const c of cpus) {
    const t = c.times || {};
    const sum = Number(t.user || 0) + Number(t.nice || 0) + Number(t.sys || 0) + Number(t.idle || 0) + Number(t.irq || 0);
    total += sum;
    idle += Number(t.idle || 0);
  }
  return { idle, total, at: Date.now() };
}

function getCpuUsagePct() {
  const now = sampleCpu();
  if (!cpuSample) {
    cpuSample = now;
    return null;
  }
  const idleDelta = now.idle - cpuSample.idle;
  const totalDelta = now.total - cpuSample.total;
  cpuSample = now;
  if (!Number.isFinite(totalDelta) || totalDelta <= 0) return null;
  return Math.max(0, Math.min(100, (1 - idleDelta / totalDelta) * 100));
}

function getDiskStats() {
  try {
    const root = path.parse(process.cwd()).root || process.cwd();
    const s = statfsSync(root);
    const blockSize = Number(s.bsize || s.frsize || 0);
    const total = Number(s.blocks || 0) * blockSize;
    const free = Number(s.bfree || 0) * blockSize;
    const used = Math.max(0, total - free);
    const usedPct = total > 0 ? (used / total) * 100 : null;
    return { totalBytes: total, freeBytes: free, usedBytes: used, usedPct };
  } catch {
    return { totalBytes: null, freeBytes: null, usedBytes: null, usedPct: null };
  }
}

export function getSystemStats() {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = Math.max(0, totalMem - freeMem);
  const memPct = totalMem > 0 ? (usedMem / totalMem) * 100 : null;
  return {
    cpuUsagePct: getCpuUsagePct(),
    memoryUsedBytes: usedMem,
    memoryTotalBytes: totalMem,
    memoryUsedPct: memPct,
    disk: getDiskStats(),
    uptimeSec: os.uptime(),
    // Best-effort placeholders; can be upgraded with vendor tools (e.g. nvidia-smi) later.
    gpuUsagePct: null,
    gpuTempC: null,
    cpuTempC: null,
  };
}
