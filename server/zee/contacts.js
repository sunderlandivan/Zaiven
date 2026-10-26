/**
 * Lightweight contact store for the Communications module.
 *
 * Storage: JSON file under server/data/, gitignored.
 * Schema:
 *   id, name, preferredPlatform ("meet"|"zoom"|"teams"|"discord"),
 *   email, phone (optional),
 *   zoomUrl (optional, the contact's Zoom personal meeting URL),
 *   teamsEmail (optional, AD/M365 email for Teams call deep link),
 *   discordUserId (optional, snowflake for /users/{id} deep link),
 *   notes, createdAt, updatedAt
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "data");
const STORE_PATH = path.join(DATA_DIR, "zee-contacts.json");

const VALID_PLATFORMS = new Set(["meet", "zoom", "teams", "discord"]);

function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(STORE_PATH)) {
    fs.writeFileSync(STORE_PATH, JSON.stringify({ contacts: [] }, null, 2));
  }
}

function readStore() {
  ensureFile();
  try {
    const v = JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
    return { contacts: Array.isArray(v?.contacts) ? v.contacts : [] };
  } catch {
    return { contacts: [] };
  }
}

function writeStore(value) {
  ensureFile();
  fs.writeFileSync(STORE_PATH, JSON.stringify(value, null, 2));
}

function normalize(input = {}) {
  const name = String(input.name || "").trim();
  if (!name) throw new Error("Contact name required.");
  let preferredPlatform = String(input.preferredPlatform || "meet")
    .trim()
    .toLowerCase();
  if (preferredPlatform === "jitsi") preferredPlatform = "meet"; // legacy migration
  if (!VALID_PLATFORMS.has(preferredPlatform)) {
    throw new Error(`Invalid platform "${preferredPlatform}". Use one of: ${[...VALID_PLATFORMS].join(", ")}.`);
  }
  return {
    name,
    preferredPlatform,
    email: String(input.email || "").trim() || null,
    phone: String(input.phone || "").trim() || null,
    zoomUrl: String(input.zoomUrl || "").trim() || null,
    teamsEmail: String(input.teamsEmail || "").trim() || null,
    discordUserId: String(input.discordUserId || "").trim() || null,
    notes: String(input.notes || "").trim() || null,
  };
}

export function listContacts() {
  return readStore().contacts.slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

export function getContact(id) {
  const safeId = String(id || "").trim();
  if (!safeId) return null;
  return readStore().contacts.find((c) => c.id === safeId) || null;
}

/** Loose name match (case-insensitive substring or exact). */
export function findContactByName(query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return null;
  const all = readStore().contacts;
  const exact = all.find((c) => String(c.name).toLowerCase() === q);
  if (exact) return exact;
  const partial = all.find((c) => String(c.name).toLowerCase().includes(q));
  if (partial) return partial;
  const tokens = q.split(/\s+/).filter(Boolean);
  if (tokens.length > 1) {
    const fuzzy = all.find((c) => {
      const lower = String(c.name).toLowerCase();
      return tokens.every((t) => lower.includes(t));
    });
    if (fuzzy) return fuzzy;
  }
  return null;
}

export function addContact(input) {
  const normalized = normalize(input);
  const store = readStore();
  const now = new Date().toISOString();
  const contact = {
    id: crypto.randomUUID(),
    ...normalized,
    createdAt: now,
    updatedAt: now,
  };
  store.contacts.push(contact);
  writeStore(store);
  return contact;
}

export function updateContact(id, patch) {
  const safeId = String(id || "").trim();
  const store = readStore();
  const idx = store.contacts.findIndex((c) => c.id === safeId);
  if (idx < 0) throw new Error("Contact not found.");
  const merged = normalize({ ...store.contacts[idx], ...patch });
  store.contacts[idx] = {
    ...store.contacts[idx],
    ...merged,
    updatedAt: new Date().toISOString(),
  };
  writeStore(store);
  return store.contacts[idx];
}

export function deleteContact(id) {
  const safeId = String(id || "").trim();
  const store = readStore();
  const before = store.contacts.length;
  store.contacts = store.contacts.filter((c) => c.id !== safeId);
  if (store.contacts.length === before) throw new Error("Contact not found.");
  writeStore(store);
  return { deleted: true };
}
