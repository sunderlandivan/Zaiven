import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const hubRoot = path.resolve(here, "../..");

/** Resolve site URL + bearer token without committing secrets. */
export function loadMarketingConfig() {
  const candidates = [
    path.join(here, "config.json"),
    path.join(hubRoot, "data", "agent-token.json"),
  ];
  let file = {};
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    try {
      file = JSON.parse(fs.readFileSync(p, "utf8"));
      break;
    } catch {
      /* try next */
    }
  }
  const site = file.site || "https://preeminentstore.com";
  const token = process.env.PREEMINENT_AGENT_TOKEN || file.token || "";
  if (!token) {
    throw new Error(
      "Missing agent token. Set PREEMINENT_AGENT_TOKEN or create scripts/marketing/config.json (see config.example.json)."
    );
  }
  return { site, token, hubRoot, here };
}
