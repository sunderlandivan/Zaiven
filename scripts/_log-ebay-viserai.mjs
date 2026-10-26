import fs from "fs";
import path from "path";
import { applySaleLine, readTab, getSheetSyncSettings } from "../server/sheetLedger.js";
import { DECKS_PATH, deckCostFor } from "../server/customDecks.js";

const orderNumber = "06-15326-50323";
const title = "Flesh And Blood VISERAI USURP CC DECK 60 + GEAR";
const cost = deckCostFor({ title }) ?? 18.99;
const settings = getSheetSyncSettings();
const sold = await readTab(settings.soldTab);
const backupDir = path.join("data", "backups");
fs.mkdirSync(backupDir, { recursive: true });
const backupPath = path.join(backupDir, `sold-2026-before-ebay-viserai-2026-10-20.json`);
fs.writeFileSync(backupPath, JSON.stringify({ tab: sold.tab, headers: sold.headers, rows: sold.rows }, null, 2));
console.log("backup", backupPath, "rows", sold.rows.length);

const results = await applySaleLine({
  description: title,
  itemId: `Ebay ${title}`,
  qty: 1,
  unitPrice: 19.99,
  shipping: 6.22,
  fees: 5.89,
  labelCost: 6.22,
  marketTax: 2.29,
  date: "2026-10-19",
  orderNumber,
  channel: "eBay",
  cost,
  notes: "Tracking 9400108106244666937842; shipped 10/20/2026 USPS Ground Advantage",
});
console.log("sheet", JSON.stringify(results, null, 2));

const file = JSON.parse(fs.readFileSync(DECKS_PATH, "utf8"));
const deck = (file.decks || []).find((d) => d.id === "deck-267791024583");
if (deck) {
  deck.qty = 0;
  file.ebaySales ||= [];
  if (!file.ebaySales.some((s) => s.eventId === `manual:${orderNumber}`)) {
    file.ebaySales.push({
      eventId: `manual:${orderNumber}`,
      at: new Date().toISOString(),
      lines: [{ id: deck.id, qty: 1 }],
    });
  }
  fs.writeFileSync(DECKS_PATH, JSON.stringify(file, null, 2) + "\n");
  console.log("deck qty now", deck.qty);
} else console.log("deck not found");
