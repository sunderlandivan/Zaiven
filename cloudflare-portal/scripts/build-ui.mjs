// Builds dist/ (the Worker's static assets): the PC portal's own pages copied from ../public (never edited in place),
// plus the cloud shell and cloud-only pages from ./public. Each copied page gets the cloud shell (role-based nav, sign-out,
// shadow-mode locks, "Available on the PC portal" notes) and loses the PC-only nav script.
//   node scripts/build-ui.mjs
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { PORTAL_DIR, ROOT } from "./lib.mjs";

const PC_PUBLIC = path.join(ROOT, "public");
const CLOUD_PUBLIC = path.join(PORTAL_DIR, "public");
const DIST = path.join(PORTAL_DIR, "dist");

// Zee, the card game and Treasure Hunt stay on the PC. Scripts listed in "drop" would call PC-only APIs on page load.
const PC_PAGES = {
  "inventory-orders.html": {},
  "inventory-stock.html": {},
  "inventory-analytics.html": {},
  "inventory-dashboard-analytics.html": {},
  "inventory-marketing.html": {},
  "inventory-sheet-sync.html": {},
  "inventory-tax-prep.html": {},
  "inventory-loan.html": {},
  "inventory-import.html": { drop: ["/inventory.js"] },
  "order-doc.html": {},
};
const PC_ASSETS = [
  "inventory.css",
  "inventory.js",
  "inventory-stock.js",
  "inventory-dashboard-charts.js",
  "inventory-marketing.js",
  "inventory-sheet-sync.js",
  "inventory-tax-prep.js",
  "inventory-loan.js",
  "order-doc.js",
];
const SHELL = '    <link rel="stylesheet" href="/cloud.css" />\n    <script src="/cloud.js" defer></script>\n';

function transformPage(name, html, { drop = [] }) {
  let out = html.replace(/\s*<script type="module" src="\/inventory-nav\.js"><\/script>/g, "");
  for (const src of drop) out = out.replace(new RegExp(`\\s*<script[^>]*src="${src.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}"[^>]*></script>`, "g"), "");
  out = out.replace(/<nav class="nav-links">[\s\S]*?<\/nav>/, '<nav class="nav-links" id="cloudNav" aria-label="Portal pages"></nav>');
  out = out.replace(/\s*<a class="nav-footer-link" href="\/">[^<]*<\/a>/, "");
  // The CSP allows no inline script; cloud.js binds [data-cloud-print] instead.
  out = out.replace(/\sonclick="window\.print\(\)"/g, " data-cloud-print");
  // script-src is 'self' only, so the pinned Chart.js the PC pages load from jsDelivr is served from ./vendor.
  out = out.replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/chart\.js@4\.4\.1\/dist\/chart\.umd\.min\.js"[^>]*><\/script>/g, '<script src="/vendor/chart.umd.min.js"></script>');
  if (/<script[^>]+src="https?:\/\//.test(out)) console.warn(`WARNING: ${name} loads a third-party script; the portal CSP (script-src 'self') will block it.`);
  if (!out.includes("</head>")) throw new Error(`${name}: no </head>`);
  return out.replace("</head>", `${SHELL}  </head>`);
}

// Empty dist/ rather than deleting it: OneDrive or a running `wrangler dev` can hold the folder itself open.
fs.mkdirSync(DIST, { recursive: true });
for (const entry of fs.readdirSync(DIST)) {
  fs.rmSync(path.join(DIST, entry), { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
fs.cpSync(CLOUD_PUBLIC, DIST, { recursive: true });
fs.cpSync(path.join(PORTAL_DIR, "vendor"), path.join(DIST, "vendor"), { recursive: true });
for (const [name, opts] of Object.entries(PC_PAGES)) {
  fs.writeFileSync(path.join(DIST, name), transformPage(name, fs.readFileSync(path.join(PC_PUBLIC, name), "utf8"), opts));
}
for (const name of PC_ASSETS) fs.copyFileSync(path.join(PC_PUBLIC, name), path.join(DIST, name));
fs.cpSync(path.join(PC_PUBLIC, "brand"), path.join(DIST, "brand"), { recursive: true });
const mark = path.join(ROOT, "storefront", "brand", "mark.png");
if (fs.existsSync(mark)) {
  fs.mkdirSync(path.join(DIST, "store", "brand"), { recursive: true });
  fs.copyFileSync(mark, path.join(DIST, "store", "brand", "mark.png"));
}

let raw = 0;
let gz = 0;
let files = 0;
const INLINE_SCRIPT = /\son[a-z]+\s*=|<script(?![^>]*\bsrc=)[^>]*>|href\s*=\s*["']?javascript:/i;
for (const f of fs.readdirSync(DIST, { recursive: true })) {
  const p = path.join(DIST, f);
  if (!fs.statSync(p).isFile()) continue;
  if (p.endsWith(".html") && INLINE_SCRIPT.test(fs.readFileSync(p, "utf8"))) {
    console.warn(`WARNING: ${f} has inline script or an on*= handler; the portal CSP (script-src 'self') will block it.`);
  }
  const buf = fs.readFileSync(p);
  raw += buf.length;
  gz += zlib.gzipSync(buf).length;
  files += 1;
}
console.log(`dist/: ${files} files, ${(raw / 1024).toFixed(0)} KB (${(gz / 1024).toFixed(0)} KB gzipped)`);
