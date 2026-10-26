import fs from "fs";
import path from "path";
import readline from "readline";
import { fileURLToPath } from "url";

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
export const LISTINGS_PATH = path.join(DATA_DIR, "tcgplayer-listings.json");

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

const num = (v) => {
  const n = Number(String(v ?? "").replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

/**
 * Reads a TCGplayer seller "pricing" export (the whole catalog, one row per SKU/condition)
 * and keeps only the rows that are actually listed: quantity on hand or a marketplace price set.
 */
async function readListings(file) {
  const rl = readline.createInterface({ input: fs.createReadStream(file, "utf8"), crlfDelay: Infinity });
  let header = null;
  const rows = [];
  for await (const raw of rl) {
    const line = raw.replace(/^\uFEFF/, "");
    if (!line.trim()) continue;
    if (!header) {
      header = parseCsvLine(line);
      continue;
    }
    const cells = parseCsvLine(line);
    const get = (name) => cells[header.indexOf(name)];
    const qty = num(get("Total Quantity"));
    const price = num(get("TCG Marketplace Price"));
    if (qty <= 0 && price <= 0) continue;
    rows.push({
      skuId: Number(get("TCGplayer Id")),
      line: get("Product Line"),
      set: get("Set Name"),
      name: get("Product Name"),
      number: get("Number") || "",
      rarity: get("Rarity") || "",
      condition: get("Condition") || "",
      market: num(get("TCG Market Price")),
      low: num(get("TCG Low Price")),
      lowWithShipping: num(get("TCG Low Price With Shipping")),
      qty,
      price,
      photo: get("Photo URL") || "",
    });
  }
  return rows;
}

export async function importTcgplayerExports(files) {
  const all = [];
  const perFile = {};
  for (const f of files) {
    const rows = await readListings(f);
    perFile[path.basename(f)] = rows.length;
    all.push(...rows);
  }
  const payload = { importedAt: new Date().toISOString(), files: perFile, listings: all };
  fs.writeFileSync(LISTINGS_PATH, JSON.stringify(payload, null, 2));
  return payload;
}

export function getTcgplayerListings() {
  try {
    return JSON.parse(fs.readFileSync(LISTINGS_PATH, "utf8"));
  } catch {
    return { importedAt: null, files: {}, listings: [] };
  }
}
