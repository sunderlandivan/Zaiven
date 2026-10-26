// Prints the live portal's last cron result and recent activity from the remote D1 (no customer data).
import { wrangler } from "./lib.mjs";

const q = (sql) => {
  const out = wrangler(["d1", "execute", "DB", "--remote", "--json", "--command", sql]);
  return JSON.parse(out.slice(out.indexOf("[")))[0].results;
};
const parts = q("SELECT data FROM doc_parts WHERE name = 'cron-state' ORDER BY idx");
console.log("cron-state:", parts.length ? parts.map((r) => r.data).join("") : "none yet");
console.log("cloud docs:", JSON.stringify(q("SELECT name, updated_at FROM docs WHERE source = 'cloud' ORDER BY name")));
console.log("activity:", JSON.stringify(q("SELECT at, kind, message FROM activity ORDER BY id DESC LIMIT 5")));
