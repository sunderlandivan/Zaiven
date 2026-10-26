// Writes cloudflare-portal/.dev.vars (gitignored) for `wrangler dev`. Sheet writes stay off locally.
import fs from "node:fs";
import path from "node:path";
import { PORTAL_DIR, collectSecrets, describe } from "./lib.mjs";

// No AGENT_TOKEN locally: "Mark paid" in dev must never email a real buyer through the live store.
const { AGENT_TOKEN, ...secrets } = collectSecrets();
const lines = Object.entries({
  ...secrets,
  SHEET_WRITES: "off",
}).map(([k, v]) => `${k}=${JSON.stringify(v)}`);
fs.writeFileSync(path.join(PORTAL_DIR, ".dev.vars"), lines.join("\n") + "\n", { mode: 0o600 });
console.log(`.dev.vars written (${describe(secrets)}; SHEET_WRITES=off)`);
