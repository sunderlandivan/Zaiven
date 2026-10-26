// Local-only: a non-test paid website order goes through the cloud's Sold 2026 planning with SHEET_WRITES=off.
// Afterwards re-run `node scripts/migrate-data.mjs` to reset the local D1.
import fs from "node:fs";
import path from "node:path";
import { PORTAL_DIR, wrangler } from "./lib.mjs";
import { createSessions, deleteSessions } from "./test-sessions.mjs";

const BASE = "http://localhost:8788";
const vars = fs.readFileSync(path.join(PORTAL_DIR, ".dev.vars"), "utf8");
if (!/SHEET_WRITES="off"/.test(vars)) throw new Error("SHEET_WRITES must be off in .dev.vars for this test.");
const sessions = await createSessions([{ email: "iv3nsun@gmail.com" }]);
const [{ cookie: Cookie, csrf }] = sessions;
process.on("exit", () => deleteSessions(sessions));
const call = async (p, method = "GET", body) =>
  (await fetch(BASE + p, { method, headers: { Cookie, Origin: BASE, "X-CSRF-Token": csrf, "Content-Type": "application/json" }, body: body && JSON.stringify(body) })).json();

const rows = (await call("/api/sheet-sync/rows")).rows.filter((r) => r.tab === "Inventory26" && r.qty > 1);
const stock = (await call("/api/store/stock")).stock.items;
const [id, it] = Object.entries(stock).find(([, s]) => rows.some((r) => r.itemId === s.t));
const order = {
  id: "DRYRUN-P1", paymentMethod: "paypal", status: "paid", total: it.p, shipping: 0, paypalFee: 0.5,
  createdAt: new Date().toISOString(), paidAt: new Date().toISOString(),
  lines: [{ id, qty: 1, name: it.n, title: it.t, single: false, price: it.p }], shipTo: { name: "Dry Run", address: {} },
};
wrangler(["kv", "key", "put", `order:${order.id}`, JSON.stringify(order), "--binding", "STORE", "--local"]);
await call("/api/role", "POST", { role: "active", confirm: "PC portal is stopped" });
const pub = await call("/api/store/publish", "POST");
const sync = await call("/api/sheet-sync");
const ev = sync.needsReview.find((e) => e.id === `web:${order.id}`);
await call("/api/role", "POST", { role: "shadow" });
console.log(JSON.stringify({ item: it.t, intake: pub.intake, event: ev && { status: ev.status, note: ev.note, plan: ev.lines.map((l) => ({ action: l.plan.action, row: l.plan.stockRow?.rowNumber, tab: l.plan.stockRow?.tab })) } }, null, 2));
