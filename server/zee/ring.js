import fs from "fs";
import path from "path";

const DATA_PATH = path.join(process.cwd(), "data", "zee-ring-state.json");

function readState() {
  try {
    if (!fs.existsSync(DATA_PATH)) return { lastRingAt: null, events: [] };
    const raw = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
    if (!raw || typeof raw !== "object") return { lastRingAt: null, events: [] };
    if (!Array.isArray(raw.events)) raw.events = [];
    return raw;
  } catch {
    return { lastRingAt: null, events: [] };
  }
}

function writeState(next) {
  fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
  fs.writeFileSync(DATA_PATH, JSON.stringify(next, null, 2), "utf8");
}

function env(name) {
  return String(process.env[name] || "").trim();
}

export function getRingStatus() {
  const snapshotUrl = env("ZEE_RING_SNAPSHOT_URL");
  const streamUrl = env("ZEE_RING_STREAM_URL");
  const st = readState();
  return {
    configured: Boolean(snapshotUrl || streamUrl),
    snapshotUrl: snapshotUrl || null,
    streamUrl: streamUrl || null,
    lastRingAt: st.lastRingAt || null,
    recentEvents: (st.events || []).slice(-10).reverse(),
  };
}

export function markRingEvent(eventType, payload = {}) {
  const st = readState();
  st.events = Array.isArray(st.events) ? st.events : [];
  st.events.push({
    at: Date.now(),
    type: String(eventType || "event"),
    payload,
  });
  if (st.events.length > 80) st.events = st.events.slice(-80);
  if (String(eventType || "").toLowerCase() === "ring") st.lastRingAt = Date.now();
  writeState(st);
  return { ok: true, lastRingAt: st.lastRingAt || null };
}
