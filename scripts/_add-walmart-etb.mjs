import fs from "fs";
import path from "path";
import { applyPurchaseLine, readTab, getSheetSyncSettings } from "../server/sheetLedger.js";

const settings = getSheetSyncSettings();
const inv = await readTab("Inventory26");
const existing = inv.rows.find((r) => /30th Celebration Elite Trainer Box - ME: 30th Celebration/i.test(String(r.itemId||"")) && !/Pokemon Center|PC /i.test(String(r.itemId||"")));
console.log("template", existing ? { row: existing.rowNumber, itemId: existing.itemId, qty: existing.qty, cost: existing.cost, link: existing.link } : null);

const backupDir = path.join("data", "backups");
fs.mkdirSync(backupDir, { recursive: true });
fs.writeFileSync(
  path.join(backupDir, "inventory26-before-walmart-etb-2026-10-20.json"),
  JSON.stringify({ headers: inv.headers, rows: inv.rows.filter((r) => /30th Celebration/i.test(String(r.itemId||""))) }, null, 2)
);

// New row at Walmart cost so we don't blend with the $140 lot (highest-cost pricing baseline stays $140).
const result = await applyPurchaseLine({
  description: "30th Celebration Elite Trainer Box - ME: 30th Celebration (30C)",
  qty: 3,
  unitCost: 75.04,
  createNew: true,
  newItemId: "30th Celebration Elite Trainer Box - ME: 30th Celebration (30C)",
  template: {
    itemId: "30th Celebration Elite Trainer Box - ME: 30th Celebration (30C)",
    code: "ETB",
    type: "ETB",
    link: existing?.link || "https://www.tcgplayer.com/product/704143/pokemon-me-30th-celebration-30th-celebration-elite-trainer-box",
    lastRetail: existing?.lastRetail,
  },
});
console.log("purchase", JSON.stringify(result, null, 2));

const after = await readTab("Inventory26");
const hits = after.rows.filter((r) => /30th Celebration Elite Trainer Box - ME: 30th Celebration/i.test(String(r.itemId||"")) && !/Pokemon Center/i.test(String(r.itemId||"")));
for (const r of hits) console.log(JSON.stringify({ row: r.rowNumber, qty: r.qty, cost: r.cost, itemId: r.itemId }));
