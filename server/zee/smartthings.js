/**
 * Samsung SmartThings API client (official, supported).
 * Auth: Personal Access Token (PAT) from https://account.smartthings.com/tokens
 * Required scopes (minimum): r:devices:*, x:devices:*
 * @see https://developer.smartthings.com/docs/api/public
 */
import axios from "axios";
import {
  getOauthAccessToken,
  isOauthConfigured,
  isOauthConnected,
  getOauthStatus,
} from "./smartthingsOauth.js";

const BASE = "https://api.smartthings.com/v1";
const TOKEN_ENV = "ZEE_SMARTTHINGS_TOKEN";
const LOCATION_ENV = "ZEE_SMARTTHINGS_LOCATION_ID";

let cache = { at: 0, devices: null };
const CACHE_TTL = 8_000;

function pat() {
  return String(process.env[TOKEN_ENV] || "").trim();
}

/**
 * Resolve the bearer token to use. Prefers a long-lived OAuth access token
 * (auto-refreshed) and falls back to the 24h Personal Access Token if OAuth
 * is not configured / not yet connected / refresh fails.
 */
async function resolveBearer() {
  if (isOauthConnected()) {
    try {
      const tok = await getOauthAccessToken();
      if (tok) return { token: tok, source: "oauth" };
    } catch (e) {
      const fallback = pat();
      if (fallback) return { token: fallback, source: "pat", warn: String(e.message || e) };
      throw e;
    }
  }
  const fallback = pat();
  if (fallback) return { token: fallback, source: "pat" };
  return { token: "", source: "none" };
}

async function authHeaders() {
  const { token } = await resolveBearer();
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };
}

function isConfigured() {
  return Boolean(pat()) || isOauthConnected();
}

function locationFilter() {
  return String(process.env[LOCATION_ENV] || "").trim();
}

async function listAllDevices() {
  // List ALL devices, not just ones declaring `switch`. Some devices are
  // controllable but report capabilities like `switchLevel` or
  // `colorControl` without `switch` in the capabilities array. We include
  // everything and let the client decide which rows are togglable.
  const res = await axios.get(`${BASE}/devices`, {
    headers: await authHeaders(),
    timeout: 12_000,
    validateStatus: () => true,
  });
  if (res.status !== 200) {
    throw new Error(`SmartThings /devices failed (${res.status}): ${JSON.stringify(res.data).slice(0, 200)}`);
  }
  const items = Array.isArray(res.data?.items) ? res.data.items : [];
  const loc = locationFilter();
  const filtered = loc ? items.filter((d) => String(d.locationId || "") === loc) : items;
  return filtered;
}

async function getDeviceStatus(deviceId) {
  const res = await axios.get(`${BASE}/devices/${encodeURIComponent(deviceId)}/status`, {
    headers: await authHeaders(),
    timeout: 8_000,
    validateStatus: () => true,
  });
  if (res.status !== 200) return null;
  const main = res.data?.components?.main || {};
  const switchAttr = main.switch?.switch?.value;
  const washerRawRemaining =
    main["custom.washerOperatingState"]?.remainingTimeStr?.value ??
    main["custom.washerOperatingState"]?.remainingTime?.value ??
    null;
  const dryerRawRemaining =
    main["custom.dryerOperatingState"]?.remainingTimeStr?.value ??
    main["custom.dryerOperatingState"]?.remainingTime?.value ??
    null;
  const washerState =
    main["custom.washerOperatingState"]?.machineState?.value ??
    main["custom.washerOperatingState"]?.washerJobState?.value ??
    null;
  const dryerState =
    main["custom.dryerOperatingState"]?.machineState?.value ??
    main["custom.dryerOperatingState"]?.dryerJobState?.value ??
    null;
  return {
    on: switchAttr === "on",
    raw: main,
    telemetry: {
      washerRemaining: washerRawRemaining,
      dryerRemaining: dryerRawRemaining,
      washerState,
      dryerState,
    },
  };
}

/**
 * Returns [{id,label,room,manufacturer,on,locationId,components}].
 * Caches for a few seconds to avoid hammering the API on UI polls.
 */
export async function listSmartHomeDevices({ force = false } = {}) {
  if (!isConfigured()) {
    return { ok: false, configured: false, error: `Set ${TOKEN_ENV} (SmartThings PAT).`, devices: [] };
  }
  if (!force && cache.devices && Date.now() - cache.at < CACHE_TTL) {
    return { ok: true, configured: true, cached: true, devices: cache.devices };
  }
  try {
    const list = await listAllDevices();
    const out = [];
    await Promise.all(
      list.map(async (d) => {
        const caps = (d.components?.[0]?.capabilities || []).map((c) => c.id);
        const switchable = caps.includes("switch");
        let on = null;
        let telemetry = null;
        let statusRaw = null;
        try {
          const s = await getDeviceStatus(d.deviceId);
          on = s?.on ?? null;
          telemetry = s?.telemetry ?? null;
          statusRaw = s?.raw ?? null;
        } catch {
          on = null;
          telemetry = null;
          statusRaw = null;
        }
        out.push({
          id: d.deviceId,
          label: d.label || d.name || "Device",
          name: d.name,
          room: d.roomId || null,
          locationId: d.locationId || null,
          manufacturer: d.manufacturerName || null,
          ocfDeviceType: d.ocfDeviceType || null,
          on,
          switchable,
          capabilities: caps,
          telemetry,
          statusRaw,
        });
      })
    );
    // Sort: switchable first (alpha within group), then non-switchable.
    out.sort((a, b) => {
      if (a.switchable !== b.switchable) return a.switchable ? -1 : 1;
      return String(a.label).localeCompare(String(b.label));
    });
    cache = { at: Date.now(), devices: out };
    return { ok: true, configured: true, devices: out };
  } catch (e) {
    return { ok: false, configured: true, error: String(e.message || e), devices: [] };
  }
}

/**
 * @param {string} deviceId SmartThings device id (uuid).
 * @param {boolean} on
 */
export async function setSmartHomeSwitch(deviceId, on) {
  if (!isConfigured()) return { ok: false, error: `Set ${TOKEN_ENV} (SmartThings PAT).` };
  if (!deviceId) return { ok: false, error: "deviceId required" };
  const cmd = {
    commands: [
      {
        component: "main",
        capability: "switch",
        command: on ? "on" : "off",
        arguments: [],
      },
    ],
  };
  try {
    const headers = await authHeaders();
    const res = await axios.post(`${BASE}/devices/${encodeURIComponent(deviceId)}/commands`, cmd, {
      headers: { ...headers, "Content-Type": "application/json" },
      timeout: 10_000,
      validateStatus: () => true,
    });
    if (res.status >= 200 && res.status < 300) {
      cache.at = 0;
      return { ok: true, on };
    }
    return {
      ok: false,
      error: `SmartThings command failed (${res.status}): ${JSON.stringify(res.data).slice(0, 240)}`,
    };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

/**
 * Resolve a spoken/written name to a device id (loose match).
 * @param {string} query
 */
export async function resolveSmartHomeDevice(query) {
  const q = String(query || "")
    .trim()
    .toLowerCase();
  if (!q) return { ok: false, error: "device name required" };
  const list = await listSmartHomeDevices();
  if (!list.ok) return list;
  const devices = list.devices || [];
  const norm = (s) => String(s || "").toLowerCase();
  const exact = devices.find((d) => norm(d.label) === q || norm(d.name) === q);
  if (exact) return { ok: true, device: exact };
  const partial = devices.find((d) => norm(d.label).includes(q) || norm(d.name).includes(q));
  if (partial) return { ok: true, device: partial };
  const fuzzy = devices.find((d) => {
    const w = q.split(/\s+/).filter(Boolean);
    return w.length > 1 && w.every((part) => norm(d.label).includes(part));
  });
  if (fuzzy) return { ok: true, device: fuzzy };
  return { ok: false, error: `No device matched "${query}".`, devices: devices.map((d) => d.label) };
}

export function getSmartHomeStatus() {
  const oauth = getOauthStatus();
  const auth = oauth.connected
    ? "oauth"
    : pat()
      ? "pat"
      : oauth.configured
        ? "oauth-pending"
        : "none";
  return {
    configured: isConfigured(),
    locationIdFilter: locationFilter() || null,
    tokenEnv: TOKEN_ENV,
    auth,
    oauth: {
      configured: oauth.configured,
      connected: oauth.connected,
      redirectUri: oauth.redirectUri,
      connectedAt: oauth.connectedAt,
      expiresAt: oauth.expiresAt,
    },
    patSet: Boolean(pat()),
  };
}
