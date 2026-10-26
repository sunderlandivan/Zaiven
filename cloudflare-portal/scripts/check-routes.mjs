// Confirms the portal's only public hostname is the custom domain and its workers.dev URL is off. Uses wrangler's login; prints no tokens.
import fs from "node:fs";
import path from "node:path";

const token = fs.readFileSync(path.join(process.env.APPDATA, "xdg.config", ".wrangler", "config", "default.toml"), "utf8").match(/oauth_token\s*=\s*"([^"]+)/)[1];
const account = "cf045a36e86733b49d94fac3604e69b3";
const api = (p) => fetch(`https://api.cloudflare.com/client/v4/accounts/${account}${p}`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());

const [sub, script, domains] = await Promise.all([api("/workers/subdomain"), api("/workers/scripts/preeminent-portal/subdomain"), api("/workers/domains")]);
console.log("workers.dev enabled for portal:", script.result?.enabled, "| previews:", script.result?.previews_enabled);
console.log("custom domains:", (domains.result || []).filter((d) => d.service === "preeminent-portal").map((d) => d.hostname).join(", ") || "none");
if (sub.result?.subdomain) {
  const r = await fetch(`https://preeminent-portal.${sub.result.subdomain}.workers.dev/api/whoami`).catch((e) => ({ status: `unreachable (${e.cause?.code || e.message})` }));
  console.log("workers.dev URL answers:", r.status);
}
