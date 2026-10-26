/**
 * Persistent media-device preferences (camera + microphone) for the HUD.
 *
 * Storage: server/data/zee-devices.json (gitignored).
 * Schema: {
 *   camera:     { label: string, deviceId: string|null, groupId: string|null, lastSeenAt: ISOString|null },
 *   microphone: { label: string, deviceId: string|null, groupId: string|null, lastSeenAt: ISOString|null },
 * }
 *
 * Labels are the canonical source of truth (deviceIds rotate per browser /
 * Chrome profile). The browser side enumerates devices, label-matches against
 * the saved label, and writes the matching deviceId back. voice.js then uses
 * `audio: { deviceId: { ideal } }` constraints when opening the mic.
 *
 * Seeded on first run with the user's preferred devices.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
const STORE_PATH = path.join(DATA_DIR, "zee-devices.json");

const DEFAULT_PREFS = {
  camera: { label: "EMEET SmartCam Nova 4k", deviceId: null, groupId: null, lastSeenAt: null },
  microphone: { label: "AT2020USB+", deviceId: null, groupId: null, lastSeenAt: null },
};

function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(STORE_PATH)) {
    fs.writeFileSync(STORE_PATH, JSON.stringify(DEFAULT_PREFS, null, 2));
  }
}

function readStore() {
  ensureFile();
  try {
    const v = JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
    return {
      camera: { ...DEFAULT_PREFS.camera, ...(v?.camera || {}) },
      microphone: { ...DEFAULT_PREFS.microphone, ...(v?.microphone || {}) },
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

function writeStore(value) {
  ensureFile();
  fs.writeFileSync(STORE_PATH, JSON.stringify(value, null, 2));
}

export function getDevicePrefs() {
  return readStore();
}

/**
 * Patch the prefs. Accepts partial { camera: {...}, microphone: {...} } objects.
 * Any field not provided is preserved.
 */
export function setDevicePrefs(patch = {}) {
  const cur = readStore();
  const next = { ...cur };
  for (const kind of /** @type {const} */ (["camera", "microphone"])) {
    const incoming = patch?.[kind];
    if (!incoming || typeof incoming !== "object") continue;
    next[kind] = {
      label: typeof incoming.label === "string" && incoming.label.trim() ? incoming.label.trim() : cur[kind].label,
      deviceId: typeof incoming.deviceId === "string" ? incoming.deviceId : cur[kind].deviceId,
      groupId: typeof incoming.groupId === "string" ? incoming.groupId : cur[kind].groupId,
      lastSeenAt: incoming.lastSeenAt ? String(incoming.lastSeenAt) : cur[kind].lastSeenAt,
    };
  }
  writeStore(next);
  return next;
}

/**
 * Lightweight summary for clients: returns only label + whether a deviceId is
 * resolved (without exposing the deviceId itself, which is per-browser).
 */
export function getDevicePrefsSummary() {
  const p = readStore();
  return {
    camera: { label: p.camera.label, resolved: Boolean(p.camera.deviceId), lastSeenAt: p.camera.lastSeenAt },
    microphone: {
      label: p.microphone.label,
      resolved: Boolean(p.microphone.deviceId),
      lastSeenAt: p.microphone.lastSeenAt,
    },
  };
}
