import fs from "fs";
import path from "path";

const DATA_PATH = path.join(process.cwd(), "data", "zee-alexa-devices.json");

function readFileRows() {
  try {
    if (!fs.existsSync(DATA_PATH)) return [];
    const raw = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
    if (!Array.isArray(raw)) return [];
    return raw;
  } catch {
    return [];
  }
}

function parseEnvRows() {
  try {
    const raw = String(process.env.ZEE_ALEXA_DEVICES_JSON || "").trim();
    if (!raw) return [];
    const j = JSON.parse(raw);
    if (!Array.isArray(j)) return [];
    return j;
  } catch {
    return [];
  }
}

export function listAlexaAppDevices() {
  const rows = [...readFileRows(), ...parseEnvRows()];
  return rows
    .map((r, i) => {
      const label = String(r?.label || r?.name || "").trim();
      if (!label) return null;
      return {
        id: `alexa-app:${String(r?.id || label || i).toLowerCase().replace(/\s+/g, "-")}`,
        label,
        name: label,
        room: r?.room ? String(r.room) : null,
        locationId: null,
        manufacturer: "Amazon (Alexa app)",
        ocfDeviceType: null,
        on: null,
        switchable: false,
        capabilities: [],
        source: "alexa-app",
        readOnlyReason: "Imported from Alexa app list; control requires Alexa Smart Home skill API credentials.",
      };
    })
    .filter(Boolean);
}
