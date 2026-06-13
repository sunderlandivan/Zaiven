#!/usr/bin/env node
/** Verify Supabase connection and schema. Run: node scripts/test-supabase.mjs */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(root, ".env.local");

function loadEnv() {
  if (!existsSync(envPath)) {
    console.error("Missing .env.local");
    process.exit(1);
  }
  const env = {};
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.replace(/\r$/, "").trim();
    const m = trimmed.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

const env = loadEnv();
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || url.includes("PASTE") || !key || key.includes("PASTE")) {
  console.error("\n❌ Supabase keys not set in .env.local yet.");
  console.error("   Copy publishable + secret keys from Supabase → Settings → API Keys");
  console.error("   (Click the copy icon next to each key — screenshots are truncated.)\n");
  process.exit(1);
}

const supabase = createClient(url, serviceKey && !serviceKey.includes("PASTE") ? serviceKey : key);

const tables = ["facilities", "residents", "sessions", "mood_logs", "staff_alerts", "staff"];

console.log("\n=== SeniorMind Supabase Check ===\n");
console.log("URL:", url);

for (const table of tables) {
  const { error, count } = await supabase.from(table).select("*", { count: "exact", head: true });
  if (error) {
    console.log(`❌ ${table}: ${error.message}`);
  } else {
    console.log(`✓  ${table}: OK (${count ?? 0} rows)`);
  }
}

const { data: facility } = await supabase.from("facilities").select("name").limit(1).single();
if (facility) console.log(`\n✓  Pilot facility: ${facility.name}`);

console.log("\n");
