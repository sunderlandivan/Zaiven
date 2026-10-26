/**
 * Tiny persistent "follow-ups" ledger so deferred decisions don't get lost.
 *
 * File: server/data/zee-followups.json (gitignored). Each item has an id,
 * title, optional notes/tag, createdAt, completedAt.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
const STORE_PATH = path.join(DATA_DIR, "zee-followups.json");

function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(STORE_PATH)) {
    fs.writeFileSync(STORE_PATH, JSON.stringify({ items: [] }, null, 2));
  }
}

function readStore() {
  ensureFile();
  try {
    const v = JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
    return { items: Array.isArray(v?.items) ? v.items : [] };
  } catch {
    return { items: [] };
  }
}

function writeStore(value) {
  ensureFile();
  fs.writeFileSync(STORE_PATH, JSON.stringify(value, null, 2));
}

export function listFollowups({ includeDone = false } = {}) {
  const items = readStore().items;
  return includeDone ? items : items.filter((x) => !x.completedAt);
}

export function addFollowup({ title, notes, tag }) {
  const safeTitle = String(title || "").trim();
  if (!safeTitle) throw new Error("Followup title required.");
  const store = readStore();
  const now = new Date().toISOString();
  const item = {
    id: crypto.randomUUID(),
    title: safeTitle,
    notes: String(notes || "").trim() || null,
    tag: String(tag || "").trim() || null,
    createdAt: now,
    completedAt: null,
  };
  store.items.push(item);
  writeStore(store);
  return item;
}

/**
 * Idempotent: only adds the followup if no open item with the same tag already
 * exists. Useful for code paths that always re-register the same reminder.
 */
export function addFollowupIfMissing({ title, notes, tag }) {
  if (!tag) return addFollowup({ title, notes, tag });
  const existing = readStore().items.find((x) => x.tag === tag && !x.completedAt);
  if (existing) return existing;
  return addFollowup({ title, notes, tag });
}

export function completeFollowup(id) {
  const safeId = String(id || "").trim();
  const store = readStore();
  const idx = store.items.findIndex((x) => x.id === safeId);
  if (idx < 0) throw new Error("Followup not found.");
  store.items[idx].completedAt = new Date().toISOString();
  writeStore(store);
  return store.items[idx];
}

export function deleteFollowup(id) {
  const safeId = String(id || "").trim();
  const store = readStore();
  const before = store.items.length;
  store.items = store.items.filter((x) => x.id !== safeId);
  if (store.items.length === before) throw new Error("Followup not found.");
  writeStore(store);
  return { deleted: true };
}

/** Print open followups to the server log on boot so they stay visible. */
export function logOpenFollowups() {
  const open = listFollowups({ includeDone: false });
  if (!open.length) return;
  console.log(`[zee-followups] ${open.length} open item(s):`);
  for (const it of open) {
    console.log(`  - [${it.tag || "general"}] ${it.title}`);
  }
}
