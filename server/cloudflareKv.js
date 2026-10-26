import fs from "fs";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { fileURLToPath } from "url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
export const CF_DIR = path.join(ROOT, "cloudflare");
const WRANGLER = path.join(ROOT, "node_modules", "wrangler", "bin", "wrangler.js");
const KV_ID = "f655ff3db54a4aafbd9d98902564dbe7";

export function wrangler(args) {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [WRANGLER, ...args], { cwd: CF_DIR, maxBuffer: 64 * 1024 * 1024, timeout: 10 * 60_000, windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        const e = new Error(`wrangler ${args.slice(0, 3).join(" ")}: ${String(stderr || err.message).trim().split("\n").slice(-3).join(" ")}`);
        e.notFound = /404: Not Found/.test(`${stderr}\n${stdout}`);
        reject(e);
      } else resolve(stdout);
    });
  });
}

/** Wrangler prints a banner before some outputs; the payload is the first JSON value. */
function parseJsonOutput(out) {
  return JSON.parse(out.slice(out.search(/[[{]/)));
}

const kv = (...args) => wrangler(["kv", ...args, "--namespace-id", KV_ID, "--remote"]);

export const kvList = async (prefix) => parseJsonOutput(await kv("key", "list", "--prefix", prefix)).map((k) => k.name);
export const kvGetJson = async (key) => parseJsonOutput(await kv("key", "get", key));
export const kvDelete = (key) => kv("key", "delete", key);

/** null when the key doesn't exist; other failures (network, auth) still throw. */
export async function kvGetJsonOrNull(key) {
  try {
    return await kvGetJson(key);
  } catch (e) {
    if (e.notFound) return null;
    throw e;
  }
}

/** Binary value (e.g. an mp4) that KV deletes by itself after ttlSeconds. KV values max out at 25 MB. */
export const kvPutFile = (key, file, ttlSeconds) => kv("key", "put", key, "--path", file, "--ttl", String(ttlSeconds));

/** entries: { key: stringValue } written in one request. */
export async function kvPutMany(entries) {
  const file = path.join(os.tmpdir(), `preeminent-kv-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(Object.entries(entries).map(([key, value]) => ({ key, value }))));
  try {
    await kv("bulk", "put", file);
  } finally {
    fs.rmSync(file, { force: true });
  }
}
