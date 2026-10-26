import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const WEB_ORDERS_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "web-orders.json");

/** Paid preeminentstore.com orders pulled down from Cloudflare, newest last. */
export function readWebOrders() {
  try {
    return JSON.parse(fs.readFileSync(WEB_ORDERS_PATH, "utf8")).orders || [];
  } catch {
    return [];
  }
}

export function saveWebOrders(orders) {
  fs.writeFileSync(WEB_ORDERS_PATH, JSON.stringify({ orders }, null, 2));
}
