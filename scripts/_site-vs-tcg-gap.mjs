import fs from "fs";

const raw = fs.readFileSync(process.env.TEMP + "/kv-stock-clean.json", "utf8").replace(/^\uFEFF/, "");
const stock = JSON.parse(raw);

const todo = [
  ["onepiece", "Two Legends - Booster Box"],
  ["onepiece", "Adventure on Kami's Island Booster Box"],
  ["pokemon", "Perfect Order 3 Pack Blister [Chikorita]"],
  ["pokemon", "Pitch Black 3-Pack Blister [Binacle]"],
  ["pokemon", "Pokemon Day 2026 Collection"],
  ["pokemon", "Lumiose City Mini Tin Display"],
  ["pokemon", "151 Booster Pack"],
  ["pokemon", "Delta Reign Booster Bundle"],
  ["pokemon", "Delta Reign Booster Box"],
  ["magic", "Lorwyn Eclipsed - Play Booster Display"],
  ["magic", "Avatar: The Last Airbender - Jumpstart Booster Display"],
  ["magic", "Marvel Super Heroes - Play Booster Display"],
  ["magic", "Marvel Super Heroes Commander Deck Case"],
  ["magic", "Secrets of Strixhaven - Bundle"],
  ["magic", "Secrets of Strixhaven - Play Booster Display"],
  ["magic", "Secrets of Strixhaven Commander Deck Case"],
  ["magic", "Reality Fracture - Collector Booster Display"],
  ["fab", "Arcane Rising Booster Box [Unlimited Edition]"],
  ["fab", "Compendium of Rathe Booster Box"],
  ["fab", "Crucible of War Booster Box [Unlimited Edition]"],
  ["fab", "Tales of Aria Booster Box [Unlimited Edition]"],
  ["fab", "Welcome to Rathe Booster Box [Unlimited Edition]"],
  ["fab", "Omens of the Third Age Booster Box"],
  ["fab", "Mistveil Archive"],
];

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function find(name) {
  const want = norm(name);
  const words = want.split(" ").filter((w) => w.length > 2);
  let best = null;
  let bestScore = 0;
  for (const [id, it] of Object.entries(stock.items)) {
    if ((it.q | 0) <= 0) continue;
    if (it.s === "single" || it.s === "deck") continue;
    const hay = norm(`${it.n} ${it.t}`);
    let score = 0;
    if (hay.includes(want)) score = 100;
    else score = words.filter((w) => hay.includes(w)).length;
    if (score > bestScore) {
      bestScore = score;
      best = { id, name: it.n, qty: it.q, price: it.p, floor: it.f, score };
    }
  }
  if (!best || best.score < Math.min(3, words.length)) return null;
  return best;
}

const sealed = Object.entries(stock.items).filter(([, it]) => it.s === "standard" && (it.q | 0) > 0);
console.log("STOCK_UPDATED", stock.updatedAt);
console.log("SEALED_IN_STOCK", sealed.length);
console.log("---TODO_GAPS_ON_SITE---");
for (const [game, name] of todo) {
  const m = find(name);
  if (m) {
    console.log(
      JSON.stringify({
        game,
        todo: name,
        id: m.id,
        siteName: m.name,
        qty: m.qty,
        price: m.price,
        floor: m.floor,
      })
    );
  } else {
    console.log(JSON.stringify({ game, todo: name, onSite: false }));
  }
}
