import fs from "fs";
import path from "path";

const ROOT = "C:/Users/TheIv/LocalDev/TCG";
const TEMP = process.env.TEMP;

const gaps = [
  { id: "542504", name: "Two Legends Booster Box", game: "One Piece" },
  { id: "682057", name: "Adventure on Kami's Island Booster Box", game: "One Piece" },
  { id: "672393", name: "Perfect Order 3-Pack Blister [Chikorita]", game: "Pokémon" },
  { id: "692938", name: "Pitch Black 3-Pack Blister [Binacle]", game: "Pokémon" },
  { id: "668590", name: "Pokemon Day 2026 Collection", game: "Pokémon" },
  { id: "685574", name: "Lumiose City Mini Tin Display", game: "Pokémon" },
  { id: "504467", name: "151 Booster Pack", game: "Pokémon" },
  { id: "712097", name: "Delta Reign Booster Bundle", game: "Pokémon" },
  { id: "712094", name: "Delta Reign Booster Box", game: "Pokémon" },
  { id: "656312", name: "Lorwyn Eclipsed Play Display", game: "Magic" },
  { id: "648679", name: "Avatar Jumpstart Display", game: "Magic" },
  { id: "675603", name: "Marvel Super Heroes Play Display", game: "Magic" },
  { id: "675635", name: "Marvel Super Heroes Commander Deck Case", game: "Magic" },
  { id: "675561", name: "Secrets of Strixhaven Bundle", game: "Magic" },
  { id: "675555", name: "Secrets of Strixhaven Play Display", game: "Magic" },
  { id: "675572", name: "Secrets of Strixhaven Commander Deck Case", game: "Magic" },
  { id: "692983", name: "Reality Fracture Collector Display", game: "Magic" },
  { id: "224730", name: "Arcane Rising Unlimited Box", game: "FAB" },
  { id: "664844", name: "Compendium of Rathe Box", game: "FAB" },
  { id: "245615", name: "Crucible of War Unlimited Box", game: "FAB" },
  { id: "253572", name: "Tales of Aria Unlimited Box", game: "FAB" },
  { id: "224727", name: "Welcome to Rathe Unlimited Box", game: "FAB" },
  { id: "682814", name: "Omens of the Third Age Box", game: "FAB" },
  {
    id: "flesh-and-blood-tcg-part-the-mistveil-archive-booster-box-japanese-exclusive-fab",
    name: "Mistveil Archive (JP)",
    game: "FAB",
  },
];

function parseMoney(s) {
  const n = Number(String(s || "").replace(/[$,]/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

function parseCsv(file) {
  const text = fs.readFileSync(path.join(ROOT, "data/imports", file), "utf8");
  const lines = text.split(/\r?\n/);
  const rows = [];
  for (const line of lines) {
    if (!line || line.startsWith(",,,") || line.startsWith("Item ID") || line.startsWith("Grand")) continue;
    const cols = [];
    let cur = "";
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        q = !q;
        continue;
      }
      if (c === "," && !q) {
        cols.push(cur);
        cur = "";
        continue;
      }
      cur += c;
    }
    cols.push(cur);
    if (cols.length < 5) continue;
    rows.push({
      name: cols[0],
      cost: parseMoney(cols[4]),
      retail: parseMoney(cols[6]),
      link: cols[16] || "",
      file,
    });
  }
  return rows;
}

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/poké/g, "poke")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function matchCost(sheetRows, gap) {
  const want = norm(gap.name);
  const words = want.split(" ").filter((w) => w.length > 2);
  let best = null;
  let bestScore = 0;
  for (const r of sheetRows) {
    if (!(r.cost > 0)) continue;
    const hay = norm(r.name);
    let score = 0;
    if (hay.includes(want)) score = 100;
    else score = words.filter((w) => hay.includes(w)).length;
    // product id in link
    if (gap.id && /^\d+$/.test(gap.id) && r.link.includes(`/product/${gap.id}/`)) score = 200;
    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }
  if (!best || bestScore < 3) return null;
  return best;
}

const stock = JSON.parse(fs.readFileSync(path.join(TEMP, "kv-stock-clean.json"), "utf8").replace(/^\uFEFF/, ""));
const sheet = [...parseCsv("Inventory26.csv"), ...parseCsv("Inventory25.csv")];

// Highest cost among matching rows (owner pricing rule)
const byKey = new Map();
for (const r of sheet) {
  const key = norm(r.name);
  const prev = byKey.get(key);
  if (!prev || (r.cost || 0) > (prev.cost || 0)) byKey.set(key, r);
}

const out = [];
for (const g of gaps) {
  const st = stock.items[g.id];
  const costRow = matchCost(sheet, g);
  out.push({
    id: g.id,
    name: g.name,
    game: g.game,
    qty: st?.q ?? null,
    website: st?.p ?? null,
    cost: costRow?.cost ?? null,
    costSource: costRow ? `${costRow.file}: ${costRow.name.slice(0, 60)}` : null,
    market: null,
    marketNote: null,
  });
}

fs.writeFileSync(path.join(TEMP, "gap-prices-partial.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
