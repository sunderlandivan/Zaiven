/**
 * Build transparent PNG for Zee Audi hero card.
 * Priority: --file=path → argv URL → bundled `public/zee/assets/audi-hero-source.png` → DEFAULT_URL.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import axios from "axios";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "public", "zee", "assets", "audi-hero.png");
const LOCAL_SOURCE = path.join(ROOT, "public", "zee", "assets", "audi-hero-source.png");

const DEFAULT_URL =
  "https://cdn.discordapp.com/attachments/1116806801900437607/1500678866816073899/Screenshot_20260503_185738_Instagram1.jpg?ex=69f94f9b&is=69f7fe1b&hm=a209c865fca8700f4245927aa88abd8989a0181a710ef1256b7baeb8b0339e0f&";

function distRgb(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function sampleRgb(buf, w, h, channels, x, y) {
  const yy = Math.min(h - 1, Math.max(0, y));
  const xx = Math.min(w - 1, Math.max(0, x));
  const i = (yy * w + xx) * channels;
  return [buf[i], buf[i + 1], buf[i + 2]];
}

function parseArgs() {
  const parts = process.argv.slice(2);
  let file = "";
  let url = "";
  for (const p of parts) {
    if (p.startsWith("--file=")) file = p.slice("--file=".length).trim();
    else if (!p.startsWith("--")) url = p.trim();
  }
  return { file, url };
}

async function loadInputBuffer() {
  const { file, url } = parseArgs();
  if (file) {
    const abs = path.isAbsolute(file) ? file : path.join(ROOT, file);
    if (!fs.existsSync(abs)) throw new Error(`File not found: ${abs}`);
    return fs.readFileSync(abs);
  }
  if (url) {
    const res = await axios.get(url, {
      responseType: "arraybuffer",
      timeout: 60000,
      maxContentLength: 25 * 1024 * 1024,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      },
      validateStatus: (s) => s >= 200 && s < 300,
    });
    return Buffer.from(res.data);
  }
  if (fs.existsSync(LOCAL_SOURCE)) {
    return fs.readFileSync(LOCAL_SOURCE);
  }
  const res = await axios.get(DEFAULT_URL, {
    responseType: "arraybuffer",
    timeout: 60000,
    maxContentLength: 25 * 1024 * 1024,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    },
    validateStatus: (s) => s >= 200 && s < 300,
  });
  return Buffer.from(res.data);
}

async function main() {
  const input = await loadInputBuffer();
  const meta = await sharp(input).metadata();
  const w = meta.width || 0;
  const h = meta.height || 0;
  if (!w || !h) throw new Error("Could not read image dimensions.");

  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const channels = info.channels;
  if (channels !== 4) throw new Error(`Expected RGBA raw, got ${channels} channels.`);

  const samples = [];
  const margin = Math.max(3, Math.floor(Math.min(w, h) * 0.02));
  for (const [sx, sy] of [
    [margin, margin],
    [w - 1 - margin, margin],
    [margin, h - 1 - margin],
    [w - 1 - margin, h - 1 - margin],
    [Math.floor(w / 2), margin],
    [Math.floor(w / 2), h - 1 - margin],
    [margin, Math.floor(h / 2)],
    [w - 1 - margin, Math.floor(h / 2)],
  ]) {
    samples.push(sampleRgb(data, w, h, channels, sx, sy));
  }
  const bg = samples.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1], acc[2] + p[2]], [0, 0, 0]).map((v) => v / samples.length);

  const t0 = 38;
  const t1 = 78;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * channels;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const d = distRgb([r, g, b], bg);
      let a = 255;
      if (d <= t0) a = 0;
      else if (d < t1) a = Math.round((255 * (d - t0)) / (t1 - t0));
      data[i + 3] = Math.min(255, (data[i + 3] * a) / 255);
    }
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  await sharp(data, { raw: { width: w, height: h, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(OUT);

  const trimmed = await sharp(OUT).trim({ threshold: 12 }).png({ compressionLevel: 9 }).toBuffer();
  fs.writeFileSync(OUT, trimmed);

  console.log(`Wrote ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
