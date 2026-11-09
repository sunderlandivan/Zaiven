#!/usr/bin/env node
/**
 * Upscale product images so both sides are ≥500px (Google Merchant Center floor, Jan 31 2027).
 * Keeps aspect ratio (scales the short side up to 500). Does not stretch.
 *
 *   node scripts/resize-merchant-images.mjs              # dry-run
 *   node scripts/resize-merchant-images.mjs --write      # rewrite storefront/img/*
 *   node scripts/resize-merchant-images.mjs --write --feed-only
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IMG_DIR = path.join(ROOT, "storefront", "img");
const BACKUP_DIR = path.join(ROOT, "data", "img-backup-pre-500px");
const MIN = 500;
const write = process.argv.includes("--write");
const feedOnly = process.argv.includes("--feed-only");

async function feedImageNames() {
  const r = await fetch("https://preeminentstore.com/feed.xml");
  if (!r.ok) throw new Error(`feed.xml ${r.status}`);
  const xml = await r.text();
  const names = new Set();
  for (const m of xml.matchAll(/preeminentstore\.com\/img\/([^<"\s]+)/g)) names.add(m[1]);
  return names;
}

function listLocalImages() {
  return fs
    .readdirSync(IMG_DIR)
    .filter((n) => /\.(jpe?g|png|webp)$/i.test(n) && !/^logo/i.test(n));
}

async function needsResize(file) {
  const meta = await sharp(file).metadata();
  const w = meta.width || 0;
  const h = meta.height || 0;
  return { w, h, need: w < MIN || h < MIN, format: meta.format };
}

const names = feedOnly ? [...(await feedImageNames())] : listLocalImages();
const todo = [];
for (const name of names) {
  const src = path.join(IMG_DIR, name);
  if (!fs.existsSync(src)) {
    console.warn("missing", name);
    continue;
  }
  const info = await needsResize(src);
  if (info.need) todo.push({ name, ...info });
}

console.log(`${write ? "WRITE" : "DRY-RUN"}: ${todo.length} image(s) under ${MIN}px (${names.length} scanned${feedOnly ? ", feed-only" : ""})`);
if (!todo.length) process.exit(0);

if (write) fs.mkdirSync(BACKUP_DIR, { recursive: true });

let done = 0;
for (const item of todo) {
  const src = path.join(IMG_DIR, item.name);
  if (!write) {
    const scale = Math.max(MIN / item.w, MIN / item.h);
    console.log(`  ${item.name}  ${item.w}x${item.h} → ${Math.round(item.w * scale)}x${Math.round(item.h * scale)}`);
    continue;
  }
  if (!fs.existsSync(path.join(BACKUP_DIR, item.name))) {
    fs.copyFileSync(src, path.join(BACKUP_DIR, item.name));
  }
  const scale = Math.max(MIN / item.w, MIN / item.h);
  const nw = Math.round(item.w * scale);
  const nh = Math.round(item.h * scale);
  const tmp = `${src}.tmp`;
  const pipeline = sharp(src).resize(nw, nh, { fit: "fill", kernel: "lanczos3" });
  if (/\.jpe?g$/i.test(item.name)) await pipeline.jpeg({ quality: 90, mozjpeg: true }).toFile(tmp);
  else if (/\.png$/i.test(item.name)) await pipeline.png().toFile(tmp);
  else await pipeline.webp({ quality: 90 }).toFile(tmp);
  fs.renameSync(tmp, src);
  done++;
  if (done % 25 === 0 || done === todo.length) {
    console.log(`  ${done}/${todo.length}  ${item.name}  ${item.w}x${item.h} → ${nw}x${nh}`);
  }
}

if (write) console.log(`Done. Backups in ${path.relative(ROOT, BACKUP_DIR)}. Redeploy storefront so live /img/ picks them up.`);
