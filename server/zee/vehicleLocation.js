import axios from "axios";
import { getAudiVehicleSnapshot } from "./audiConnect.js";

function env(name) {
  return String(process.env[name] || "").trim();
}

function asNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function deepFindLatLon(node, out = []) {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const item of node) deepFindLatLon(item, out);
    return out;
  }
  const rec = node;
  const lat =
    asNum(rec.latitude) ??
    asNum(rec.lat) ??
    asNum(rec.positionLatitude) ??
    asNum(rec.carCoordinateLatitude);
  const lon =
    asNum(rec.longitude) ??
    asNum(rec.lng) ??
    asNum(rec.lon) ??
    asNum(rec.positionLongitude) ??
    asNum(rec.carCoordinateLongitude);
  if (lat != null && lon != null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
    out.push({ lat, lon });
  }
  for (const value of Object.values(rec)) deepFindLatLon(value, out);
  return out;
}

async function getLojackLocation() {
  const url = env("ZEE_LOJACK_LOCATION_URL");
  if (!url) return null;
  const token = env("ZEE_LOJACK_BEARER_TOKEN");
  const res = await axios.get(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    timeout: 12000,
    validateStatus: () => true,
  });
  if (res.status < 200 || res.status >= 300) return null;
  const hits = deepFindLatLon(res.data);
  if (!hits.length) return null;
  const first = hits[0];
  return {
    provider: "lojack",
    latitude: first.lat,
    longitude: first.lon,
    raw: res.data,
  };
}

export async function getVehicleLocationSnapshot() {
  let audiErr = null;
  try {
    const v = await getAudiVehicleSnapshot();
    const hits = deepFindLatLon(v.raw);
    if (hits.length) {
      return {
        ok: true,
        provider: "audi",
        vin: v.vin || null,
        latitude: hits[0].lat,
        longitude: hits[0].lon,
      };
    }
  } catch (e) {
    audiErr = String(e.message || e);
  }
  const loj = await getLojackLocation().catch(() => null);
  if (loj) {
    return {
      ok: true,
      provider: "lojack",
      latitude: loj.latitude,
      longitude: loj.longitude,
    };
  }
  return {
    ok: false,
    error:
      audiErr ||
      "No location available from Audi snapshot. Configure ZEE_LOJACK_LOCATION_URL for LoJack fallback.",
  };
}
