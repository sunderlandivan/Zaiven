import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import axios from "axios";
import { NetgearSoapClient } from "./netgearSoap.js";

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "data");
const SPEED_CACHE = path.join(DATA_DIR, "zee-home-network-speed.json");
const ACL_CACHE = path.join(DATA_DIR, "zee-home-network-acl.json");

/** @type {{ id: string; label: string; mac: string; ip?: string; allow?: boolean; group?: string }[]} */
const DEFAULT_TARGETS = [
  { id: "potato-pc", label: "potato-pc", mac: "44:85:00:7D:9B:00", ip: "192.168.1.26", allow: false, group: "kids" },
  { id: "william-a10e", label: "William's A10e", mac: "D6:E9:74:8C:23:13", ip: "192.168.1.28", allow: false, group: "kids" },
  { id: "williams-2nd-fire", label: "William's 2nd Fire", mac: "C0:95:CF:45:D5:76", ip: "192.168.1.15", allow: false, group: "kids" },
  { id: "ps5", label: "PS5", mac: "0C:70:43:C8:B8:F4", ip: "192.168.1.8", allow: true },
  { id: "ntp", label: "N.T.P.", mac: "BC:37:D3:9C:F7:87", ip: "192.168.1.30", allow: false, group: "kids" },
  { id: "bryans-phone", label: "Bryan's phone", mac: "AC:86:A3:32:22:BF", allow: false, group: "kids" },
];

/** Phrase "ban/unban the kids devices" maps to this id set. PS5 is never in it. */
const KIDS_DEVICE_IDS = new Set([
  "potato-pc",
  "william-a10e",
  "williams-2nd-fire",
  "ntp",
  "bryans-phone",
]);

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function normMac(m) {
  return String(m || "")
    .trim()
    .toUpperCase()
    .replace(/-/g, ":");
}

function readTargets() {
  const raw = process.env.ZEE_HOME_NETWORK_TARGETS;
  if (!raw) return DEFAULT_TARGETS;
  try {
    const j = JSON.parse(raw);
    if (!Array.isArray(j) || !j.length) return DEFAULT_TARGETS;
    return j
      .map((x) => ({
        id: String(x.id || x.label || "device"),
        label: String(x.label || x.id || "Device"),
        mac: normMac(x.mac),
        ip: x.ip ? String(x.ip) : undefined,
        allow: x.allow !== false,
        group: x.group ? String(x.group) : undefined,
      }))
      .filter((x) => x.mac);
  } catch {
    return DEFAULT_TARGETS;
  }
}

/** @type {NetgearSoapClient | null} */
let netgearClient = null;

function getSoapBaseUrl() {
  return (process.env.ZEE_NETGEAR_SOAP_URL || "http://192.168.1.1:5000").replace(/\/$/, "");
}

function getNetgearClient() {
  const password = process.env.ZEE_NETGEAR_PASSWORD;
  if (!password) return null;
  if (!netgearClient) {
    netgearClient = new NetgearSoapClient({
      soapUrl: `${getSoapBaseUrl()}/soap/server_sa/`,
      username: process.env.ZEE_NETGEAR_USER || "admin",
      password,
      forceLoginV2: String(process.env.ZEE_NETGEAR_FORCE_LOGIN_V2 || "").trim() === "1",
    });
  }
  return netgearClient;
}

async function checkInternetReachable() {
  const t0 = Date.now();
  try {
    const res = await axios.get("https://www.gstatic.com/generate_204", {
      timeout: 6000,
      validateStatus: (s) => s === 204 || s === 200,
      maxRedirects: 0,
    });
    return { ok: true, latencyMs: Date.now() - t0, status: res.status };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

/**
 * Rough download throughput via Cloudflare (does not replace a full speedtest).
 * @param {number} [bytes]
 */
async function measureDownloadMbps(bytes = 8_000_000) {
  const url = `https://speed.cloudflare.com/__down?bytes=${bytes}`;
  const t0 = Date.now();
  const res = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 120_000,
    maxContentLength: bytes + 65536,
    maxBodyLength: bytes + 65536,
    validateStatus: (s) => s === 200,
  });
  const ms = Date.now() - t0;
  const n = res.data?.byteLength ?? 0;
  if (ms < 1 || n < 1000) throw new Error("speed sample too small");
  const mbps = (n * 8) / ms / 1000;
  return { downloadMbps: Math.round(mbps * 10) / 10, seconds: Math.round((ms / 1000) * 100) / 100, bytes: n };
}

function readSpeedCache() {
  try {
    if (!fs.existsSync(SPEED_CACHE)) return null;
    const j = JSON.parse(fs.readFileSync(SPEED_CACHE, "utf8"));
    return j && typeof j === "object" ? j : null;
  } catch {
    return null;
  }
}

function writeSpeedCache(payload) {
  ensureDataDir();
  fs.writeFileSync(SPEED_CACHE, JSON.stringify(payload, null, 2), "utf8");
}

function defaultAclMap() {
  /** @type {Record<string, boolean>} */
  const map = {};
  for (const t of readTargets()) {
    map[normMac(t.mac)] = t.allow !== false;
  }
  return map;
}

function readAclMap() {
  try {
    if (!fs.existsSync(ACL_CACHE)) return defaultAclMap();
    const j = JSON.parse(fs.readFileSync(ACL_CACHE, "utf8"));
    const byMac = j && typeof j === "object" ? j.byMac : null;
    if (!byMac || typeof byMac !== "object") return defaultAclMap();
    /** @type {Record<string, boolean>} */
    const map = defaultAclMap();
    for (const [mac, allow] of Object.entries(byMac)) {
      map[normMac(mac)] = Boolean(allow);
    }
    return map;
  } catch {
    return defaultAclMap();
  }
}

function writeAclMap(map) {
  ensureDataDir();
  fs.writeFileSync(ACL_CACHE, JSON.stringify({ at: Date.now(), byMac: map }, null, 2), "utf8");
}

function setDesiredAllow(mac, allow) {
  const map = readAclMap();
  map[normMac(mac)] = Boolean(allow);
  writeAclMap(map);
  return map;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * @param {{ force?: boolean }} [opts]
 */
export async function runHomeNetworkSpeedTest(opts = {}) {
  const force = Boolean(opts.force);
  const prev = readSpeedCache();
  if (!force && prev?.at && Date.now() - Number(prev.at) < DAY_MS) {
    return {
      ok: true,
      cached: true,
      hint: "Last result is less than 24h old; pass force=true to run again.",
      ...prev,
    };
  }
  const net = await checkInternetReachable();
  if (!net.ok) {
    return { ok: false, error: `Internet check failed: ${net.error || "unknown"}` };
  }
  const sp = await measureDownloadMbps();
  const row = {
    at: Date.now(),
    downloadMbps: sp.downloadMbps,
    sampleBytes: sp.bytes,
    sampleSeconds: sp.seconds,
    source: "cloudflare __down",
    internetLatencyMs: net.latencyMs,
  };
  writeSpeedCache(row);
  return { ok: true, cached: false, ...row };
}

export function getHomeNetworkSpeedCache() {
  return readSpeedCache();
}

export async function getHomeNetworkStatus() {
  const net = await checkInternetReachable();
  const speed = readSpeedCache();
  const router = Boolean(process.env.ZEE_NETGEAR_PASSWORD);
  return {
    internetOk: net.ok,
    internetLatencyMs: net.latencyMs ?? null,
    internetError: net.ok ? null : net.error || null,
    speed,
    routerConfigured: router,
    soapBaseUrl: router ? getSoapBaseUrl() : null,
    targets: readTargets(),
  };
}

/**
 * Merge router device list (if any) with configured targets for UI.
 */
export async function getHomeNetworkDevices() {
  const targets = readTargets();
  const desired = readAclMap();
  writeAclMap(desired);
  const client = getNetgearClient();
  if (!client) {
    const merged = targets.map((t) => {
      const mac = normMac(t.mac);
      const allow = desired[mac] !== false;
      return {
        ...t,
        mac,
        onRouter: false,
        routerName: null,
        routerIp: t.ip || null,
        allowOrBlock: allow ? "Allow" : "Block",
        desiredAllow: allow,
        pending: !allow,
      };
    });
    return { ok: true, router: false, targets, devices: [], merged };
  }
  let att;
  try {
    att = await client.getAttachDevice2();
  } catch (e) {
    att = { ok: false, error: String(e.message || e) };
  }
  if (!att.ok) {
    const merged = targets.map((t) => {
      const mac = normMac(t.mac);
      const allow = desired[mac] !== false;
      return {
        ...t,
        mac,
        onRouter: false,
        routerName: null,
        routerIp: t.ip || null,
        allowOrBlock: allow ? "Allow" : "Block",
        desiredAllow: allow,
        pending: true,
        routerError: att.error || "router list failed",
      };
    });
    return { ok: true, router: true, error: att.error || "router list failed", raw: att.raw, targets, devices: [], merged };
  }
  const byMac = new Map(att.devices.map((d) => [normMac(d.mac || ""), d]));
  const merged = [];
  for (const t of targets) {
    const mac = normMac(t.mac);
    const r = byMac.get(mac);
    const desiredAllow = desired[mac] !== false;
    let routerAllow = r ? (r.allowOrBlock || "Allow") !== "Block" : null;
    // If the device is on the LAN and its ACL doesn't match what we want,
    // push the desired Allow/Block now (covers reconnects of phones/tablets).
    if (r && routerAllow !== desiredAllow) {
      const applied = await setHomeNetworkDeviceAllow(mac, desiredAllow);
      if (applied.ok && applied.applied !== false) {
        routerAllow = desiredAllow;
      }
    }
    const allow = desiredAllow;
    merged.push({
      ...t,
      mac,
      onRouter: Boolean(r),
      routerName: r?.name || null,
      routerIp: r?.ip || t.ip || null,
      allowOrBlock: allow ? "Allow" : "Block",
      routerAllowOrBlock: r?.allowOrBlock || null,
      desiredAllow: allow,
      pending: Boolean(r) ? routerAllow !== desiredAllow : !desiredAllow,
    });
  }
  return { ok: true, router: true, targets, devices: att.devices, merged };
}

/**
 * @param {string} mac
 * @param {boolean} allow - true = internet allowed, false = blocked at router
 */
export async function setHomeNetworkDeviceAllow(mac, allow) {
  const wanted = Boolean(allow);
  setDesiredAllow(mac, wanted);
  const client = getNetgearClient();
  if (!client) {
    return {
      ok: true,
      mac: normMac(mac),
      allow: wanted,
      applied: false,
      pending: true,
      hint: "Saved locally. Set ZEE_NETGEAR_PASSWORD to push this to the Nighthawk.",
    };
  }
  const status = wanted ? "Allow" : "Block";
  try {
    const r = await client.setBlockDeviceByMAC(normMac(mac), status);
    if (!r.ok) {
      return {
        ok: true,
        mac: normMac(mac),
        allow: wanted,
        applied: false,
        pending: true,
        error: r.error || "router command failed",
        raw: r.raw,
      };
    }
    return { ok: true, mac: normMac(mac), allow: wanted, applied: true, pending: false };
  } catch (e) {
    return {
      ok: true,
      mac: normMac(mac),
      allow: wanted,
      applied: false,
      pending: true,
      error: String(e.message || e),
    };
  }
}

export function listKidsDevices() {
  return readTargets().filter((t) => KIDS_DEVICE_IDS.has(t.id) || t.group === "kids");
}

/**
 * Ban or unban the kids-device group. PS5 is never included.
 * @param {boolean} allow
 */
export async function setKidsDevicesAllow(allow) {
  const wanted = Boolean(allow);
  const kids = listKidsDevices();
  const results = [];
  for (const t of kids) {
    results.push(await setHomeNetworkDeviceAllow(t.mac, wanted));
  }
  return {
    ok: true,
    allow: wanted,
    action: wanted ? "unban" : "ban",
    count: kids.length,
    devices: kids.map((t) => ({ id: t.id, label: t.label, mac: t.mac })),
    results,
  };
}
