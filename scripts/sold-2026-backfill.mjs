/**
 * One-time Sold 2026 tax backfill (Oct 12, 2026). Run scripts/sold-2026-reconcile.mjs first.
 *  1. Backs up Sold 2026 (values + formulas) to data/backups/.
 *  2. Adds the Order #/Channel/tax columns (P:W) to the header.
 *  3. Fills those columns on rows already matched to an order (existing cells A:O are not touched).
 *  4. Appends rows for 2026 orders with no row, through applySaleLine. Inventory is NOT adjusted (no stockRow).
 * Usage: node scripts/sold-2026-backfill.mjs [--dry]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applySaleLine, ensureSoldColumns, getSheetSyncSettings, readTab } from "../server/sheetLedger.js";
import { batchUpdateValues, columnLetter, getValues } from "../server/googleSheets.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DRY = process.argv.includes("--dry");
const recon = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "sold-2026-recon.json"), "utf8"));
const { spreadsheetId, soldTab } = getSheetSyncSettings();
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const money = (n) => round2(n).toFixed(2);

// ---------- 1. backup ----------
const csvCell = (v) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (rows) => rows.map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const backupDir = path.join(ROOT, "data", "backups");
fs.mkdirSync(backupDir, { recursive: true });
const backupPath = path.join(backupDir, `sold-2026-${stamp}.csv`);
fs.writeFileSync(backupPath, toCsv(await getValues(spreadsheetId, soldTab, "A1:Z", "FORMATTED_VALUE")));
fs.writeFileSync(backupPath.replace(/\.csv$/, "-formulas.csv"), toCsv(await getValues(spreadsheetId, soldTab, "A1:Z", "FORMULA")));
console.log("backup:", path.relative(ROOT, backupPath));
if (DRY) console.log("(dry run: no sheet writes)");

// ---------- 2. columns ----------
const before = await readTab(soldTab);
if (before.rows.some((r) => String(r.orderNumber || "").trim())) {
  console.log("Order # column already filled: skipping annotation (re-run reconcile for a fresh match list).");
} else {
  const cols = DRY ? null : (await ensureSoldColumns()).cols;

  // ---------- 3. annotate matched rows ----------
  const orders = new Map(recon.orders.map((o) => [o.orderNumber, o]));
  const sheetRow = new Map(recon.sheetRows.map((r) => [r.rowNumber, r]));
  const info = new Map(); // rowNumber -> { orders:[], channel:Set, marketTax, ourTax, labelCost, refund, notes:[] }
  const slot = (n) => {
    if (!info.has(n)) info.set(n, { orders: [], channels: new Set(), marketTax: 0, ourTax: 0, labelCost: 0, refund: 0, hasLabel: false, notes: [], feeBasis: "" });
    return info.get(n);
  };
  const aggRows = new Set(recon.aggregates.flatMap((a) => a.rows));

  for (const m of recon.matches) {
    const o = orders.get(m.orderNumber);
    if (!o) continue;
    const isAgg = m.rows.every((n) => aggRows.has(n)) && m.how === "owner aggregate rows";
    const target = m.rows[0];
    for (const n of m.rows) {
      const s = slot(n);
      if (!isAgg || n === target) s.orders.push(o.orderNumber);
      s.channels.add(o.channel);
    }
    // Order-level money goes on the order's first row only so column totals stay exact.
    const s = slot(target);
    s.marketTax += Number(o.marketTax || 0);
    s.ourTax += Number(o.ourTax || 0);
    if (o.labelCost != null) { s.labelCost += Number(o.labelCost); s.hasLabel = true; }
    if (m.canceled) {
      s.notes.push(`Order ${o.orderNumber} was CANCELED on ${o.channel} (no sale) — owner to verify this row.`);
      continue;
    }
    if (o.refund) {
      s.refund += Number(o.refund);
      s.notes.push(`${o.refundType === "full" ? "Full" : "Partial"} refund $${money(o.refund)} on ${o.orderNumber}.`);
    }
    const row = sheetRow.get(target);
    if (!isAgg && m.rows.length === 1 && row) {
      if (Math.abs(row.total - o.product) > 0.01) s.notes.push(`Order product total $${money(o.product)} vs row $${money(row.total)}.`);
      if (Math.abs(row.shipping - o.shipping) > 0.01) s.notes.push(`Order shipping charged $${money(o.shipping)} vs row $${money(row.shipping)}.`);
      if (o.feeBasis === "actual" && Math.abs(row.fees - o.fees) > 0.01) s.notes.push(`Actual ${o.channel} fees $${money(o.fees)} vs row $${money(row.fees)}.`);
    }
    if (o.feeBasis === "actual" && !isAgg) s.feeBasis = "owner-entered (actual on file)";
  }
  for (const a of recon.aggregates) {
    slot(a.rows[0]).notes.push(
      `Owner batch row covering ${a.orders.length} TCGplayer singles orders (6/26–7/07): actual product $${money(a.product)} + shipping $${money(a.shipping)}. Rows ${a.rows.join(" and ")} both show $203.52 — likely double-counted; owner to fix.`
    );
    for (const n of a.rows.slice(1)) slot(n).notes.push(`See row ${a.rows[0]} (batch of singles orders); amount looks duplicated.`);
  }
  for (const r of recon.unmatchedRows) slot(r.rowNumber).notes.push("No matching 2026 order found on TCGplayer, eBay or the website — owner to verify.");
  for (const [orderNumber, p] of Object.entries(recon.partial || {})) {
    const m = recon.matches.find((x) => x.orderNumber === orderNumber);
    if (m) slot(m.rows[0]).notes.push(`Logs 1 of ${orders.get(orderNumber).lines[0].qty} units; the other unit was added as its own row.`);
  }

  if (!DRY) {
    const updates = [];
    for (const [n, s] of info) {
      const vals = {
        orderNumber: s.orders.join(", "),
        channel: [...s.channels].join(", "),
        marketTax: s.marketTax ? round2(s.marketTax) : "",
        ourTax: s.ourTax ? round2(s.ourTax) : "",
        labelCost: s.hasLabel ? round2(s.labelCost) : "",
        refund: s.refund ? round2(s.refund) : "",
        feeBasis: s.orders.length ? s.feeBasis || "owner-entered" : "",
        notes: s.notes.join(" "),
      };
      for (const [key, v] of Object.entries(vals)) {
        if (v === "" || cols[key] == null) continue;
        updates.push({ range: `${columnLetter(cols[key])}${n}`, values: [[v]] });
      }
    }
    await batchUpdateValues(spreadsheetId, soldTab, updates);
    console.log(`annotated ${info.size} rows (${updates.length} cells)`);
  } else {
    console.log(`would annotate ${info.size} rows`);
  }
}

// ---------- 4. append missing ----------
const adds = [];
for (const orderNumber of recon.missing) {
  const o = recon.orders.find((x) => x.orderNumber === orderNumber);
  const product = o.lines.reduce((s, l) => s + l.ext, 0) || 1;
  o.lines.forEach((l, i) => {
    const share = l.ext / product;
    adds.push({
      description: l.description,
      itemId: l.cost?.itemId || l.description,
      qty: l.qty,
      unitPrice: l.unitPrice,
      shipping: i === 0 ? o.shipping : 0,
      fees: round2(o.fees * share),
      date: o.date,
      cost: l.cost?.actualCost,
      costUnknown: l.cost?.actualCost == null,
      orderNumber,
      channel: o.channel,
      marketTax: i === 0 ? o.marketTax : undefined,
      labelCost: i === 0 ? o.labelCost ?? undefined : undefined,
      refund: i === 0 && o.refund ? o.refund : undefined,
      feeBasis: o.feeBasis,
      notes: `Backfilled ${new Date().toLocaleDateString("en-US")} from ${o.channel} order history; inventory not adjusted.${l.cost?.actualCost == null ? " Cost unknown (no stock row)." : ""}`,
    });
  });
}
for (const [orderNumber, p] of Object.entries(recon.partial || {})) {
  const o = recon.orders.find((x) => x.orderNumber === orderNumber);
  const l = o.lines[0];
  adds.push({
    description: l.description,
    itemId: l.cost?.itemId || l.description,
    qty: p.qty,
    unitPrice: l.unitPrice,
    shipping: 0,
    fees: 0,
    date: o.date,
    cost: l.cost?.actualCost,
    costUnknown: l.cost?.actualCost == null,
    orderNumber,
    channel: o.channel,
    feeBasis: "on row with the 1st unit",
    notes: `2nd unit of order ${orderNumber}; shipping, fees and tax are on row with the 1st unit. Backfilled; inventory not adjusted.`,
  });
}

for (const a of adds) {
  console.log(DRY ? "would add" : "add", a.orderNumber, a.qty, a.itemId.slice(0, 50), a.unitPrice, a.shipping, a.fees, "cost", a.cost ?? "(blank)");
  if (DRY) continue;
  const res = await applySaleLine({ ...a, stockRow: null });
  console.log("  ->", JSON.stringify(res));
}
