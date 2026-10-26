import path from "path";
import { fileURLToPath } from "url";
import { importYearSheets } from "../server/yearSheetsImport.js";

const root = path.dirname(fileURLToPath(import.meta.url));
const downloads = path.join(process.env.USERPROFILE || "", "Downloads");

const result = importYearSheets({
  inventory2025Path: path.join(downloads, "Poke Inventory - Inventory25.csv"),
  inventory2026Path: path.join(downloads, "Poke Inventory - Inventory26.csv"),
  sold2025Path: path.join(downloads, "Poke Inventory - Sold 2025.csv"),
  sold2026Path: path.join(downloads, "Poke Inventory - Sold 2026 (1).csv"),
  clearSalesLedger: true,
});

console.log(JSON.stringify(result, null, 2));
