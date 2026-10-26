// Deploys the portal Worker with its secrets (from a temp file that is deleted right after), then checks it is locked.
// Data is NOT uploaded here; run scripts/migrate-data.mjs --remote afterwards (it re-checks the lock first).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PORTAL_URL, collectSecrets, describe, wrangler } from "./lib.mjs";

const secrets = collectSecrets();
const missing = Object.entries(secrets).filter(([, v]) => !v).map(([k]) => k);
if (missing.some((k) => k !== "AGENT_TOKEN" && k !== "RESEND_API_KEY")) throw new Error(`Missing secrets: ${missing.join(", ")}. Not deploying.`);
console.log(`Secrets: ${describe(secrets)}`);

await import("./build-ui.mjs");
wrangler(["d1", "migrations", "apply", "DB", "--remote"]);
const file = path.join(os.tmpdir(), `portal-secrets-${process.pid}.json`);
fs.writeFileSync(file, JSON.stringify(Object.fromEntries(Object.entries(secrets).filter(([, v]) => v))), { mode: 0o600 });
try {
  wrangler(["deploy", "--secrets-file", file]);
} finally {
  fs.rmSync(file, { force: true });
}
console.log("Deployed. Checking the lock…");
await new Promise((r) => setTimeout(r, 5000));
const who = await fetch(`${PORTAL_URL}/api/whoami`, { redirect: "manual" });
const page = await fetch(`${PORTAL_URL}/`, { redirect: "manual" });
console.log(`/api/whoami -> ${who.status} (want 401); / -> ${page.status} ${page.headers.get("location") || ""} (want 302 to /auth/login)`);
