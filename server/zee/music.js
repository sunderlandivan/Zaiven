import fs from "fs";
import path from "path";

const AUDIO_EXT = new Set([".mp3", ".flac", ".m4a", ".wav", ".ogg", ".opus"]);

export function getMusicRoot() {
  const raw = String(process.env.ZEE_MUSIC_ROOT || "C:\\SSD\\Media\\Music").trim();
  return path.resolve(raw);
}

function isUnderRoot(root, candidate) {
  const rel = path.relative(root, candidate);
  return rel && !rel.startsWith("..") && !path.isAbsolute(rel);
}

export function assertSafeMusicFile(absPath) {
  const root = getMusicRoot();
  const resolved = path.resolve(absPath);
  if (!isUnderRoot(root, resolved)) {
    throw new Error("Path escapes music root.");
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new Error("File not found.");
  }
  const ext = path.extname(resolved).toLowerCase();
  if (!AUDIO_EXT.has(ext)) throw new Error("Unsupported audio type.");
  return resolved;
}

function walkAudioFiles(dir, root, out, { maxFiles = 8000 } = {}) {
  if (out.length >= maxFiles) return;
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (out.length >= maxFiles) break;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === "node_modules" || ent.name.startsWith(".")) continue;
      walkAudioFiles(full, root, out, { maxFiles });
    } else if (ent.isFile()) {
      const ext = path.extname(ent.name).toLowerCase();
      if (!AUDIO_EXT.has(ext)) continue;
      const rel = path.relative(root, full).replace(/\\/g, "/");
      out.push({
        rel,
        title: path.basename(ent.name, ext),
        bytes: fs.statSync(full).size,
      });
    }
  }
}

/** @type {{ at: number, items: { rel: string, title: string, bytes: number }[], root: string }} */
let libraryCache = { at: 0, items: [], root: "" };
const CACHE_MS = 60_000;

export function getMusicLibrary({ force = false } = {}) {
  const root = getMusicRoot();
  const now = Date.now();
  if (!force && libraryCache.root === root && now - libraryCache.at < CACHE_MS && libraryCache.items.length) {
    return { root, items: libraryCache.items };
  }
  if (!fs.existsSync(root)) {
    libraryCache = { at: now, items: [], root };
    return { root, items: [], error: "Music directory does not exist." };
  }
  const items = [];
  walkAudioFiles(root, root, items);
  items.sort((a, b) => a.rel.localeCompare(b.rel));
  libraryCache = { at: now, items, root };
  return { root, items };
}

/**
 * @param {string} relPosix relative path with /
 */
export function resolveMusicRel(relPosix) {
  const root = getMusicRoot();
  const raw = decodeURIComponent(String(relPosix || "").trim());
  const parts = raw.replace(/\\/g, "/").split("/").filter((p) => p && p !== ".");
  if (parts.some((p) => p === "..")) throw new Error("Invalid path.");
  const abs = path.resolve(root, ...parts);
  return assertSafeMusicFile(abs);
}

const MIME = {
  ".mp3": "audio/mpeg",
  ".flac": "audio/flac",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".opus": "audio/opus",
};

/**
 * Express handler: stream file with Range support
 */
export function createMusicStreamHandler() {
  return (req, res) => {
    try {
      const rel = String(req.query?.rel || "").trim();
      if (!rel) {
        res.status(400).end("Missing rel");
        return;
      }
      const abs = resolveMusicRel(decodeURIComponent(rel));
      const stat = fs.statSync(abs);
      const size = stat.size;
      const ext = path.extname(abs).toLowerCase();
      const mime = MIME[ext] || "application/octet-stream";
      const range = String(req.headers.range || "");

      if (range && /^bytes=\d*-\d*$/.test(range)) {
        const [startS, endS] = range.replace(/bytes=/, "").split("-");
        let start = startS ? parseInt(startS, 10) : 0;
        let end = endS ? parseInt(endS, 10) : size - 1;
        if (Number.isNaN(start)) start = 0;
        if (Number.isNaN(end) || end >= size) end = size - 1;
        if (start >= size || start > end) {
          res.status(416).end();
          return;
        }
        const chunk = end - start + 1;
        res.status(206);
        res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
        res.setHeader("Accept-Ranges", "bytes");
        res.setHeader("Content-Length", String(chunk));
        res.setHeader("Content-Type", mime);
        res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
        fs.createReadStream(abs, { start, end }).pipe(res);
        return;
      }

      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Content-Length", String(size));
      res.setHeader("Content-Type", mime);
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      fs.createReadStream(abs).pipe(res);
    } catch (e) {
      res.status(400).end(String(e.message || e));
    }
  };
}
