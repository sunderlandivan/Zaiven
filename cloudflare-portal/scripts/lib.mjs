import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const PORTAL_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
export const ROOT = path.join(PORTAL_DIR, "..");
export const DATA_DIR = path.join(ROOT, "data");
const WRANGLER = path.join(ROOT, "node_modules", "wrangler", "bin", "wrangler.js");
export const PORTAL_URL = "https://portal.preeminentstore.com";

/** Runs wrangler from cloudflare-portal/. Output is returned, never echoed, so secrets in it can't leak to logs. */
export function wrangler(args, { input } = {}) {
  const r = spawnSync(process.execPath, [WRANGLER, ...args], { cwd: PORTAL_DIR, input, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  if (r.status !== 0) throw new Error(`wrangler ${args.slice(0, 3).join(" ")} failed: ${String(r.stderr || r.stdout).trim().split("\n").slice(-4).join(" ")}`);
  return r.stdout;
}

function userEnv(name) {
  if (process.env[name]) return process.env[name].trim();
  if (process.platform !== "win32") return "";
  try {
    return execFileSync("powershell", ["-NoProfile", "-Command", `[Environment]::GetEnvironmentVariable('${name}','User')`], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

const readJson = (p) => {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
};

/** Secrets the Worker needs, gathered from the PC portal's own config. Values are never printed. */
export function collectSecrets() {
  const gmail = readJson(path.join(DATA_DIR, "gmail-sync-settings.json")) || {};
  const agent = readJson(path.join(DATA_DIR, "agent-token.json")) || {};
  const resend = readJson(path.join(DATA_DIR, "resend-credentials.json")) || {};
  return {
    GOOGLE_CLIENT_ID: userEnv("GMAIL_CLIENT_ID"),
    GOOGLE_CLIENT_SECRET: userEnv("GMAIL_CLIENT_SECRET"),
    GOOGLE_REFRESH_TOKEN: String(gmail.oauth?.refreshToken || ""),
    AGENT_TOKEN: String(agent.token || ""),
    RESEND_API_KEY: String(resend.apiKey || ""),
    SESSION_SECRET: crypto.randomBytes(32).toString("base64url"),
  };
}

export const describe = (secrets) => Object.entries(secrets).map(([k, v]) => `${k}: ${v ? "set" : "MISSING"}`).join(", ");
