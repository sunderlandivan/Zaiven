/**
 * Physical inventory end-compare: sheet qtys vs pre-count baseline.
 * Writes/reads data/physical-inventory-diff-live.json for the staff portal.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { readStockRows, readTab } from "./sheetLedger.js";
import { productIdFromUrl } from "./tcgplayerCatalog.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_PATH = path.join(ROOT, "data", "physical-inventory-baseline-pre-2026-11-03.json");
const LIVE_PATH = path.join(ROOT, "data", "physical-inventory-diff-live.json");

const NOTES = {
  "618890": { kind: "partial_sale", text: "Physical ~13 then −6 case sale 11/4 → 7. ~6 units still soft vs old sheet 19." },
  "270480": { kind: "reclass", text: "No loose boxes; counted as cases (270481)." },
  "270481": { kind: "reclass", text: "Cases raised with loose-box recount." },
  "619645": { kind: "count_applied", text: "Physical: case of 6 −1 prior sale = 5." },
  "618903": { kind: "count_applied", text: "Physical = 1 Revival Trance." },
  "675635": { kind: "reclass", text: "1 sealed cmd case + Doom/Cap/Wakanda individuals." },
  "675572": { kind: "count_applied", text: "Physical: 1 SOS cmd case of 5." },
  "644279": { kind: "reclass", text: "Lucario ETBs split to own pid." },
  "610953": { kind: "count_applied", text: "Physical JT bundles = 5." },
  "666900": { kind: "count_applied", text: "Physical Fujimi = 3." },
  "624684": { kind: "count_applied", text: "Physical DR sleeved = 6." },
  "557352": { kind: "count_applied", text: "Physical Stellar sleeved = 53." },
  "621115": { kind: "count_applied", text: "Physical SPM Bundle = 5." },
  "616305": { kind: "resolved", text: "Photo audit: 15 Special Collection." },
  "648643": { kind: "resolved", text: "2 cases + 1 loose = 13." },
  "229277": { kind: "resolved", text: "3 cases + 4 loose = 22." },
  "621107": { kind: "resolved", text: "1 case + loose piles = 18." },
  "675603": { kind: "resolved", text: "3 cases + 3 loose = 21." },
  "557354": { kind: "resolved", text: "3 cases + 2 loose = 20." },
  "648679": { kind: "resolved", text: "Jumpstart ×3." },
};

function parseDate(s) {
  const t = String(s || "").trim();
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return new Date(+m[3], +m[1] - 1, +m[2]);
  const d = new Date(t);
  return Number.isNaN(+d) ? null : d;
}

export function readPhysicalInventoryReport() {
  if (!fs.existsSync(LIVE_PATH)) return null;
  return JSON.parse(fs.readFileSync(LIVE_PATH, "utf8"));
}

/** Rebuild compare from live Sheet vs baseline. */
export async function refreshPhysicalInventoryReport() {
  const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"));
  const stock = await readStockRows();
  const byPid = new Map();
  const byName = new Map();
  for (const r of stock) {
    const pid = String(productIdFromUrl(r.link || "") || "").trim();
    const n = String(r.itemId || "").trim().toLowerCase();
    if (pid) {
      const c = byPid.get(pid) || { qty: 0, name: r.itemId };
      c.qty += Number(r.qty) || 0;
      c.name = r.itemId || c.name;
      byPid.set(pid, c);
    }
    if (n) byName.set(n, (byName.get(n) || 0) + (Number(r.qty) || 0));
  }

  let soldRows = [];
  try {
    soldRows = (await readTab("Sold 2026")).rows || [];
  } catch {
    soldRows = [];
  }
  const cutoff = new Date(2026, 10, 3);
  const soldAfter = new Map();
  for (const r of soldRows) {
    const name = String(r.itemId || "").trim();
    const qty = Number(r.qty) || 0;
    if (!name || !qty) continue;
    const d = parseDate(r.date);
    if (d && d >= cutoff) soldAfter.set(name, (soldAfter.get(name) || 0) + qty);
  }

  const changes = [];
  const seen = new Set();
  for (const b of baseline.items || []) {
    const pid = String(b.pid || "");
    seen.add(pid);
    const before = Number(b.qty) || 0;
    const after =
      pid && byPid.has(pid) ? byPid.get(pid).qty : byName.get(String(b.name || "").trim().toLowerCase()) ?? 0;
    const delta = after - before;
    if (delta === 0) continue;
    const soldPost = soldAfter.get(b.name) || 0;
    const softShortage = delta < 0 ? Math.max(0, -delta - soldPost) : 0;
    const meta = NOTES[pid] || {};
    let kind = meta.kind || (delta > 0 ? "raise" : "still_open");
    if (!meta.kind && softShortage > 0) kind = "still_open";
    if (!meta.kind && softShortage === 0 && delta < 0) kind = "changed";
    changes.push({
      pid,
      name: b.name,
      before,
      after,
      delta,
      soldSinceBaseline: soldPost,
      softShortage,
      kind,
      note: meta.text || "",
    });
  }
  changes.sort((a, b) => b.softShortage - a.softShortage || a.delta - b.delta || a.name.localeCompare(b.name));

  const newPids = [];
  for (const [pid, cur] of byPid) {
    if (seen.has(pid) || cur.qty <= 0) continue;
    newPids.push({ pid, name: cur.name, qty: cur.qty });
  }
  newPids.sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name));

  const open = changes.filter((c) => c.softShortage > 0 && (c.kind === "still_open" || c.kind === "partial_sale" || !NOTES[c.pid]));
  const report = {
    comparedAt: new Date().toISOString(),
    walkthroughStatus: "complete",
    baselineFile: "data/physical-inventory-baseline-pre-2026-11-03.json",
    baselineItems: baseline.itemCount,
    unchanged: (baseline.items || []).length - changes.length,
    changed: changes.length,
    summary: {
      unitsLowered: changes.filter((c) => c.delta < 0).reduce((s, c) => s - c.delta, 0),
      unitsRaised: changes.filter((c) => c.delta > 0).reduce((s, c) => s + c.delta, 0),
      stillOpenSkus: open.length,
      stillOpenUnits: open.reduce((s, c) => s + c.softShortage, 0),
      newPidSkus: newPids.length,
    },
    stillOpen: open,
    allChanges: changes,
    raises: changes.filter((c) => c.delta > 0).sort((a, b) => b.delta - a.delta),
    newPids,
  };
  fs.writeFileSync(LIVE_PATH, JSON.stringify(report, null, 2));
  return report;
}

export async function getPhysicalInventoryReport({ refresh = false } = {}) {
  if (refresh) return refreshPhysicalInventoryReport();
  return readPhysicalInventoryReport() || (await refreshPhysicalInventoryReport());
}
