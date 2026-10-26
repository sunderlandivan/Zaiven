// One-time (repeatable until cut-over) copy of the PC portal's data/*.json into the portal's D1 database.
//   node scripts/migrate-data.mjs            -> local D1 used by `wrangler dev` (default)
//   node scripts/migrate-data.mjs --remote   -> the real D1; refuses unless the live portal rejects unauthenticated requests
// Credentials (OAuth tokens, PayPal/Resend keys, agent token) and the LAN-only Zee files are never copied.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DATA_DIR, PORTAL_URL, ROOT, wrangler } from "./lib.mjs";
import { splitParts } from "../src/chunk.js";

const remote = process.argv.includes("--remote");
const force = process.argv.includes("--force");
const target = remote ? "--remote" : "--local";

const STATE_FILES = [
  "orders-db", "inventory-db", "inventory-workflow-db", "inventory-sales-ledger", "inventory-profit-history",
  "store-stock", "store-settings", "store-price-review", "store-publish-state", "web-orders",
  "sheet-sync-settings", "sheet-sync-queue", "sheet-sync-aliases", "orders-sync-settings",
  "loan-db", "tax-prep-db", "treasure-hunt-db", "tcgplayer-single-ids", "tcgplayer-listings",
  "marketing-drafts", "marketing-insights-state",
];

function loadDocs() {
  const docs = {};
  for (const name of STATE_FILES) {
    const p = path.join(DATA_DIR, `${name}.json`);
    if (fs.existsSync(p)) docs[name] = JSON.parse(fs.readFileSync(p, "utf8"));
  }
  const gmail = path.join(DATA_DIR, "gmail-sync-settings.json");
  if (fs.existsSync(gmail)) {
    // Only the sync bookkeeping; the refresh token goes in as a Worker secret instead.
    const { sync } = JSON.parse(fs.readFileSync(gmail, "utf8"));
    docs["gmail-sync-settings"] = { sync: sync || {} };
  }
  const catalog = path.join(ROOT, "storefront", "catalog.json");
  if (fs.existsSync(catalog)) docs.catalog = JSON.parse(fs.readFileSync(catalog, "utf8"));
  return docs;
}

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

function buildSql(docs) {
  const out = [];
  const now = new Date().toISOString();
  for (const [name, value] of Object.entries(docs)) {
    const text = JSON.stringify(value);
    const parts = splitParts(text);
    out.push(`DELETE FROM doc_parts WHERE name = ${q(name)};`);
    parts.forEach((p, i) => out.push(`INSERT INTO doc_parts (name, idx, data) VALUES (${q(name)}, ${i}, ${q(p)});`));
    out.push(
      `INSERT INTO docs (name, parts, size, updated_at, source) VALUES (${q(name)}, ${parts.length}, ${text.length}, ${q(now)}, 'pc-migration') ` +
        `ON CONFLICT(name) DO UPDATE SET parts = excluded.parts, size = excluded.size, updated_at = excluded.updated_at, source = excluded.source;`
    );
  }
  out.push(`INSERT INTO activity (at, kind, message) VALUES (${q(now)}, 'migration', ${q(`copied ${Object.keys(docs).length} docs from the PC`)});`);
  return out.join("\n") + "\n";
}

async function assertProtected() {
  const who = await fetch(`${PORTAL_URL}/api/whoami`, { redirect: "manual" }).catch((e) => ({ status: 0, error: e.message }));
  const page = await fetch(`${PORTAL_URL}/`, { redirect: "manual" }).catch((e) => ({ status: 0, error: e.message }));
  const loginRedirect = page.status === 302 && /\/auth\/login|cloudflareaccess\.com/.test(page.headers.get("location") || "");
  if (who.status !== 401 && !(who.status === 302 && loginRedirect)) throw new Error(`${PORTAL_URL}/api/whoami answered ${who.status || who.error}; expected 401. Not uploading.`);
  if (!loginRedirect) throw new Error(`${PORTAL_URL}/ did not redirect to a login page (status ${page.status || page.error}). Not uploading.`);
}

function cloudRole() {
  const out = wrangler(["d1", "execute", "DB", target, "--json", "--command", "SELECT data FROM doc_parts WHERE name = 'portal-role' ORDER BY idx"]);
  const rows = JSON.parse(out.slice(out.indexOf("[")))[0]?.results || [];
  return rows.length ? JSON.parse(rows.map((r) => r.data).join("")).role : "shadow";
}

if (remote) {
  await assertProtected();
  console.log("Live portal rejects unauthenticated requests: OK");
}
wrangler(["d1", "migrations", "apply", "DB", target]);
if (cloudRole() === "active" && !force) {
  throw new Error("The cloud portal is already the active host; its data is newer than the PC's. Not overwriting (use --force only for a deliberate rollback re-seed).");
}
const docs = loadDocs();
const sql = buildSql(docs);
// Outside the repo: OneDrive briefly locks new files in synced folders, and this one holds customer data.
const file = path.join(os.tmpdir(), `portal-import-${process.pid}.sql`);
fs.writeFileSync(file, sql, { mode: 0o600 });
try {
  wrangler(["d1", "execute", "DB", target, "--file", file, ...(remote ? ["--yes"] : [])]);
} finally {
  fs.rmSync(file, { force: true });
}
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
console.log(`Copied ${Object.keys(docs).length} docs (${kb(Buffer.byteLength(sql))} SQL) to the ${remote ? "remote" : "local"} D1:`);
console.log(Object.keys(docs).join(", "));
