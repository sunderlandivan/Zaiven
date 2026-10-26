import { splitParts } from "./chunk.js";

export async function readDoc(env, name, fallback = null) {
  const { results } = await env.DB.prepare("SELECT data FROM doc_parts WHERE name = ? ORDER BY idx").bind(name).all();
  if (!results.length) return fallback;
  try {
    return JSON.parse(results.map((r) => r.data).join(""));
  } catch {
    return fallback;
  }
}

/** Replaces the whole doc in one transaction (D1 batches are atomic). */
export async function writeDoc(env, name, value, source = "cloud") {
  const text = JSON.stringify(value);
  const parts = splitParts(text);
  const stmts = [env.DB.prepare("DELETE FROM doc_parts WHERE name = ?").bind(name)];
  parts.forEach((p, i) => stmts.push(env.DB.prepare("INSERT INTO doc_parts (name, idx, data) VALUES (?, ?, ?)").bind(name, i, p)));
  stmts.push(
    env.DB.prepare(
      "INSERT INTO docs (name, parts, size, updated_at, source) VALUES (?, ?, ?, ?, ?) " +
        "ON CONFLICT(name) DO UPDATE SET parts = excluded.parts, size = excluded.size, updated_at = excluded.updated_at, source = excluded.source"
    ).bind(name, parts.length, text.length, new Date().toISOString(), source)
  );
  await env.DB.batch(stmts);
}

export async function listDocs(env) {
  const { results } = await env.DB.prepare("SELECT name, parts, size, updated_at, source FROM docs ORDER BY name").all();
  return results;
}

export async function logActivity(env, kind, message) {
  await env.DB.batch([
    env.DB.prepare("INSERT INTO activity (at, kind, message) VALUES (?, ?, ?)").bind(new Date().toISOString(), kind, String(message).slice(0, 500)),
    env.DB.prepare("DELETE FROM activity WHERE id <= (SELECT MAX(id) - 300 FROM activity)"),
  ]);
}

export async function recentActivity(env, limit = 50) {
  const { results } = await env.DB.prepare("SELECT at, kind, message FROM activity ORDER BY id DESC LIMIT ?").bind(limit).all();
  return results;
}
