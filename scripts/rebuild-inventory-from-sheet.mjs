/**
 * Rebuild staff Inventory (inventory-db.json) from live Google Sheet tabs.
 * Usage: node scripts/rebuild-inventory-from-sheet.mjs
 */
import { rebuildInventoryFromSheet } from "../server/rebuildInventoryFromSheet.js";

const result = await rebuildInventoryFromSheet({ clearSalesLedger: true });
console.log(JSON.stringify(result, null, 2));
