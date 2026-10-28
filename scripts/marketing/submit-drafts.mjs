import fs from "fs";
import { loadMarketingConfig } from "./load-config.mjs";

const { site, token } = loadMarketingConfig();
const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/marketing/submit-drafts.mjs <drafts.json>");
  process.exit(1);
}

const drafts = JSON.parse(fs.readFileSync(file, "utf8"));
if (!Array.isArray(drafts) || !drafts.length) {
  console.error("The file must contain a non-empty JSON array of drafts.");
  process.exit(1);
}

const res = await fetch(`${site}/api/agent/drafts`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ drafts }),
});
const out = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error(`Rejected (HTTP ${res.status}): ${out.error || "unknown error"}`);
  process.exit(1);
}
console.log(`Submitted ${out.saved.length} draft(s). They appear in Ivan's portal within ~5 minutes.`);
