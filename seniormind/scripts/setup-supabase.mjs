#!/usr/bin/env node
/**
 * SeniorMind Supabase setup — works on Windows without PowerShell execution policy issues.
 * Run: node scripts/setup-supabase.mjs
 * Or:  npm.cmd run supabase:setup
 */

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const projectName = "seniormind";
const envPath = join(root, ".env.local");

function run(cmd, opts = {}) {
  console.log(`> ${cmd}`);
  return execSync(cmd, {
    cwd: root,
    encoding: "utf8",
    stdio: opts.inherit ? "inherit" : ["pipe", "pipe", "pipe"],
    shell: true,
    ...opts,
  });
}

function runJson(cmd) {
  const out = run(cmd);
  const start = out.indexOf("[") >= 0 ? out.indexOf("[") : out.indexOf("{");
  if (start < 0) throw new Error(`Expected JSON from: ${cmd}\n${out}`);
  return JSON.parse(out.slice(start));
}

function setEnvLine(content, key, value) {
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, "m");
  if (re.test(content)) return content.replace(re, line);
  return `${content.trimEnd()}\n${line}\n`;
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

console.log("\n=== SeniorMind Supabase Setup ===\n");

// Step 1 — login if needed
try {
  run("npx supabase projects list -o json");
} catch {
  console.log("\nOpening browser for Supabase login (one-time)...\n");
  run("npx supabase login", { inherit: true });
}

// Step 2 — find or create project
console.log("\nChecking for existing Supabase projects...");
const projects = runJson("npx supabase projects list -o json");
let project = projects.find((p) => p.name === projectName);

if (!project) {
  console.log(`\nCreating Supabase project '${projectName}'...`);
  const orgs = runJson("npx supabase orgs list -o json");
  if (!orgs?.length) throw new Error("No Supabase organizations found.");
  project = runJson(
    `npx supabase projects create ${projectName} --org-id ${orgs[0].id} --region us-east-1 --plan free -o json`
  );
  console.log("Project created. Waiting for provisioning (~60s)...");
  sleep(60_000);
} else {
  console.log(`Found existing project: ${project.name} (${project.id})`);
}

const ref = project.id;
if (!ref) throw new Error("Could not determine project ref.");

// Step 3 — link + push schema
console.log("\nLinking project and applying database schema...");
run("npx supabase link --project-ref " + ref, { inherit: true });
run("npx supabase db push", { inherit: true });

// Step 4 — fetch API keys and update .env.local
console.log("\nFetching API keys...");
const keys = runJson(`npx supabase projects api-keys --project-ref ${ref} -o json`);
const anonKey = keys.find((k) => k.name === "anon")?.api_key;
const serviceKey = keys.find((k) => k.name === "service_role")?.api_key;
const url = `https://${ref}.supabase.co`;

if (!anonKey || !serviceKey) throw new Error("Could not fetch API keys.");

let envContent = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
envContent = setEnvLine(envContent, "NEXT_PUBLIC_SUPABASE_URL", url);
envContent = setEnvLine(envContent, "NEXT_PUBLIC_SUPABASE_ANON_KEY", anonKey);
envContent = setEnvLine(envContent, "SUPABASE_SERVICE_ROLE_KEY", serviceKey);
writeFileSync(envPath, envContent.trimEnd() + "\n");

console.log("\n=== Setup complete ===");
console.log(`  Project URL: ${url}`);
console.log("  Keys written to .env.local");
console.log("\nRestart the dev server: npm.cmd run dev\n");
