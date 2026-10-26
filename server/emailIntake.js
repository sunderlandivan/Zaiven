import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  extractBodyFromPayload,
  getHeader,
  getValidAccessToken,
  gmailCollectMessages,
  gmailGetMessage,
  hasSheetsScope,
  syncOrdersFromGmail,
} from "./gmailOrders.js";
import { listOrders } from "./inventoryAgent.js";
import { classifyTrackedGame } from "./yearSheetsImport.js";
import {
  applyPurchaseLine,
  applySaleLine,
  findBestRow,
  getSheetSyncSettings,
  readStockRows,
  rememberAlias,
} from "./sheetLedger.js";
import { lookupListing } from "./tcgplayerCatalog.js";
import { getTcgplayerListings } from "./tcgplayerPriceImport.js";
import { notifyDesktop } from "./desktopNotify.js";
import { readWebOrders } from "./webOrders.js";
import { deckCostFor, isDeckId } from "./customDecks.js";
import { isPaidOrder } from "./manualOrders.js";
import { pcLease } from "./portalLease.js";

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
const QUEUE_PATH = path.join(DATA_DIR, "sheet-sync-queue.json");

const PURCHASE_SOURCES = [
  { key: "pokemon_center", label: "Pokemon Center", senders: ["pokemoncenter.com", "em.pokemon.com"], tcgOnly: true },
  { key: "target", label: "Target", senders: ["target.com"] },
  { key: "walmart", label: "Walmart", senders: ["walmart.com"] },
  { key: "costco", label: "Costco", senders: ["costco.com"] },
  { key: "amazon", label: "Amazon", senders: ["amazon.com"] },
  { key: "tcgplayer_buy", label: "TCGplayer (buying)", senders: ["tcgplayer.com"], tcgOnly: true, buyerOnly: true },
];

const PURCHASE_SUBJECT =
  '(subject:(order OR confirmation OR receipt OR invoice OR purchase OR thank) -subject:(shipped OR delivered OR "out for delivery" OR arriving OR review OR survey OR sold))';

const PRODUCT_WORDS =
  /\b(booster|elite trainer|etb|bundle|display|collection|tin|blister|deck|case|box|pack|commander|starter|premium|prerelease)\b/i;

// ---------- queue store ----------

function readQueue() {
  if (!fs.existsSync(QUEUE_PATH)) return { events: [], seenMessageIds: [], lastRun: null };
  try {
    const q = JSON.parse(fs.readFileSync(QUEUE_PATH, "utf8"));
    return { events: [], seenMessageIds: [], lastRun: null, ...q };
  } catch {
    return { events: [], seenMessageIds: [], lastRun: null };
  }
}

function writeQueue(q) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  q.seenMessageIds = (q.seenMessageIds || []).slice(-5000);
  q.events = (q.events || []).slice(-2000);
  fs.writeFileSync(QUEUE_PATH, JSON.stringify(q, null, 2));
}

const round2 = (n) => Math.round(Number(n) * 100) / 100;

function money(re, text) {
  const m = String(text).match(re);
  if (!m) return 0;
  const n = Number(String(m[1]).replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function toIsoDate(headerDate) {
  const d = new Date(headerDate);
  return Number.isNaN(d.getTime()) ? new Date().toISOString().slice(0, 10) : d.toISOString().slice(0, 10);
}

function gmailDate(iso) {
  return String(iso || "").slice(0, 10).replace(/-/g, "/");
}

// ---------- purchase parsing ----------

const PRICE_RE = /\$\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2}))/;

function isLabelLine(line) {
  return /^(qty|quantity|price|item|subtotal|total|tax|shipping|order|sold by|seller|delivery|arrives|status|each|sku|model|dpci|tcin)\b/i.test(line) ||
    PRICE_RE.test(line) && line.replace(PRICE_RE, "").trim().length < 4;
}

function looksLikeProduct(name, tcgOnly) {
  if (!name || name.length < 6 || name.length > 220) return false;
  if (classifyTrackedGame(name)) return true;
  return Boolean(tcgOnly) && PRODUCT_WORDS.test(name);
}

function extractPurchaseLines(text, { tcgOnly, acceptAll = false }) {
  const lines = String(text).split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const found = new Map();
  const isName = acceptAll
    ? (n) => Boolean(n) && n.length >= 4 && n.length <= 220 && !isLabelLine(n) && /[a-z]{3}/i.test(n)
    : (n) => looksLikeProduct(n, tcgOnly);
  const push = (name, qty, price) => {
    const clean = name.replace(/\s*[-–|]\s*$/, "").trim();
    if (/[{};]|!important|^@media/i.test(clean) || !isName(clean)) return;
    const key = clean.toLowerCase();
    const prev = found.get(key);
    if (!prev || qty > prev.qty || (!prev.price && price)) {
      found.set(key, { description: clean, qty: Math.max(1, qty || 1), price: price || prev?.price || 0 });
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const qm = line.match(/\b(?:qty|quantity)\s*[:x]?\s*(\d{1,3})\b/i);
    if (!qm) continue;
    let name = "";
    const sameLineName = line.slice(0, qm.index).replace(PRICE_RE, "").trim();
    if (isName(sameLineName)) name = sameLineName;
    for (let j = i - 1; !name && j >= Math.max(0, i - 5); j--) {
      if (!isLabelLine(lines[j]) && isName(lines[j])) name = lines[j];
    }
    if (!name) continue;
    let price = 0;
    for (let j = i; j <= Math.min(lines.length - 1, i + 3) && !price; j++) {
      const pm = lines[j].match(PRICE_RE);
      if (pm) price = Number(pm[1].replace(/,/g, ""));
    }
    for (let j = i - 1; j >= Math.max(0, i - 3) && !price; j--) {
      const pm = lines[j].match(PRICE_RE);
      if (pm) price = Number(pm[1].replace(/,/g, ""));
    }
    push(name, Number(qm[1]), price);
  }

  if (!found.size) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const xq = line.match(/^(\d{1,3})\s*x\s+(.+)$/i) || line.match(/^(.+?)\s+x\s*(\d{1,3})$/i);
      let name = line;
      let qty = 1;
      if (xq) {
        if (/^\d/.test(xq[1])) {
          qty = Number(xq[1]);
          name = xq[2];
        } else {
          name = xq[1];
          qty = Number(xq[2]);
        }
      }
      name = name.replace(PRICE_RE, "").trim();
      if (!isName(name) || isLabelLine(name)) continue;
      const pm = line.match(PRICE_RE) || (lines[i + 1] || "").match(PRICE_RE);
      push(name, qty, pm ? Number(pm[1].replace(/,/g, "")) : 0);
    }
  }
  return [...found.values()];
}

function parsePurchaseEmail(msg, source) {
  const headers = msg.payload?.headers || [];
  const subject = getHeader(headers, "Subject");
  const from = getHeader(headers, "From");
  const date = toIsoDate(getHeader(headers, "Date"));
  const body = extractBodyFromPayload(msg.payload) || "";
  const text = `${subject}\n${body}`;
  const lc = text.toLowerCase();

  if (/message from|sent you a message|question about/i.test(subject)) return null;
  if (source.buyerOnly) {
    const seller = /you have sold|have sold|ready to ship|confirm shipment/.test(lc);
    if (seller) return null;
  }
  if (/cancel|refund/i.test(subject)) {
    return { cancel: true, subject, from, date };
  }
  if (source.key === "tcgplayer_buy") return parseTcgplayerBuyerEmail({ body, subject, date, source });
  if ((source.key === "pokemon_center" || /pokemon\.com|pokemoncenter\.com/i.test(from)) && /SKU\s*#/i.test(body)) {
    return parsePokemonCenterEmail({ body, subject, date, source });
  }

  const orderNumber =
    (text.match(/order\s*(?:number|no\.?|#|id)\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{4,})/i) || [])[1] ||
    (subject.match(/#\s*([A-Z0-9-]{5,})/i) || [])[1] ||
    "";

  const items = extractPurchaseLines(body, { tcgOnly: source.tcgOnly });
  if (!items.length) return null;

  const subtotal = money(/sub\s*-?\s*total[^$\n]*\$\s*([0-9,]+\.[0-9]{2})/i, text);
  const tax = money(/(?:estimated\s+)?(?:sales\s+)?tax(?:es)?[^$\n]{0,30}\$\s*([0-9,]+\.[0-9]{2})/i, text);
  const shipping = money(/shipping[^$\n]{0,30}\$\s*([0-9,]+\.[0-9]{2})/i, text);
  const total = money(/(?:order|grand)\s*total[^$\n]*\$\s*([0-9,]+\.[0-9]{2})/i, text);

  // Reconcile against every priced line (receipts can include non-TCG items), then keep TCG lines.
  const allItems = extractPurchaseLines(body, { tcgOnly: source.tcgOnly, acceptAll: true });
  const basis = allItems.length >= items.length ? allItems : items;
  const sumPrice = basis.reduce((a, it) => a + it.price, 0);
  const sumUnit = basis.reduce((a, it) => a + it.price * it.qty, 0);
  let priceMode = "unit";
  let reconciled = false;
  if (subtotal > 0) {
    if (Math.abs(sumUnit - subtotal) <= 1) {
      reconciled = true;
    } else if (Math.abs(sumPrice - subtotal) <= 1) {
      priceMode = "line";
      reconciled = true;
    }
  }
  const taxFactor = subtotal > 0 && tax > 0 ? (subtotal + tax) / subtotal : 1;
  const lines = items.map((it) => {
    const unit = priceMode === "line" ? it.price / it.qty : it.price;
    return {
      description: it.description,
      qty: it.qty,
      unitPrice: round2(unit),
      unitCost: round2(unit * taxFactor),
    };
  });

  return {
    kind: "purchase",
    source: source.key,
    vendor: source.label,
    orderNumber,
    date,
    subject,
    totals: { subtotal, tax, shipping, total },
    parseConfident: reconciled && lines.every((l) => l.unitPrice > 0) && Boolean(orderNumber),
    parseNote: reconciled ? "" : "Line prices did not add up to the email subtotal — check qty/cost.",
    lines,
  };
}

/**
 * TCGplayer buyer receipts list "Seller $subtotal / Order Number / Sales Tax" per seller,
 * then a Qty / Description table with no per-line prices.
 */
function parseTcgplayerBuyerEmail({ body, subject, date, source }) {
  const rows = body.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const blocks = [];
  let cur = null;
  for (let i = 0; i < rows.length; i++) {
    const line = rows[i];
    const seller = line.match(/^(.+?)\s+\$([0-9,]+\.[0-9]{2})$/);
    if (seller && /^order number:/i.test(rows[i + 1] || "") && !/total/i.test(seller[1])) {
      cur = { seller: seller[1], subtotal: Number(seller[2].replace(/,/g, "")), tax: 0, orderNumber: "", items: [] };
      cur.orderNumber = (rows[i + 1].match(/order number:\s*([A-Z0-9-]+)/i) || [])[1] || "";
      blocks.push(cur);
      continue;
    }
    if (!cur) continue;
    const tax = line.match(/sales tax:\s*\$([0-9,]+\.[0-9]{2})/i);
    if (tax) cur.tax = Number(tax[1].replace(/,/g, ""));
    if (/^qty$/i.test(line) && /^description$/i.test(rows[i + 1] || "")) {
      let j = i + 2;
      while (/^\d{1,4}$/.test(rows[j] || "") && rows[j + 1]) {
        const description = rows[j + 1].replace(/\s+-\s+(unopened|sealed)$/i, "").trim();
        cur.items.push({ qty: Number(rows[j]), description });
        j += 2;
      }
      i = j - 1;
    }
  }
  const lines = [];
  let confident = blocks.length > 0;
  for (const b of blocks) {
    const qtyTotal = b.items.reduce((a, it) => a + it.qty, 0);
    if (!qtyTotal) continue;
    if (b.items.length > 1) confident = false;
    const taxFactor = b.subtotal > 0 ? (b.subtotal + b.tax) / b.subtotal : 1;
    for (const it of b.items) {
      const unit = b.subtotal / qtyTotal;
      lines.push({ description: it.description, qty: it.qty, unitPrice: round2(unit), unitCost: round2(unit * taxFactor) });
    }
  }
  if (!lines.length) return null;
  const subtotal = round2(blocks.reduce((a, b) => a + b.subtotal, 0));
  const tax = round2(blocks.reduce((a, b) => a + b.tax, 0));
  return {
    kind: "purchase",
    source: source.key,
    vendor: source.label,
    orderNumber: blocks[0]?.orderNumber || "",
    date,
    subject,
    totals: { subtotal, tax, shipping: 0, total: money(/grand\s*total[^$\n]*\$\s*([0-9,]+\.[0-9]{2})/i, body) },
    parseConfident: confident && Boolean(blocks[0]?.orderNumber),
    parseNote: confident ? "" : "Seller had several items with one subtotal — cost was split evenly; check each cost.",
    lines,
  };
}

/** Pokemon Center lists "Name / SKU # / : sku / Qty / : n" with only an order subtotal. */
function parsePokemonCenterEmail({ body, subject, date, source }) {
  const rows = body.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const items = [];
  for (let i = 1; i < rows.length; i++) {
    if (!/^SKU\s*#/i.test(rows[i])) continue;
    const description = rows[i - 1].replace(/^Pok[eé]mon TCG:\s*/i, "").trim();
    let qty = 1;
    let price = 0;
    for (let j = i + 1; j <= i + 8 && j < rows.length && !/^SKU\s*#/i.test(rows[j]); j++) {
      const both = `${rows[j]} ${rows[j + 1] || ""}`;
      if (/^qty\b/i.test(rows[j])) qty = Number((both.match(/qty\s*:?\s*(\d+)/i) || [])[1]) || qty;
      if (/^price\b/i.test(rows[j])) {
        const pm = both.match(/\$\s*([0-9,]+\.[0-9]{2})/);
        if (pm) price = Number(pm[1].replace(/,/g, ""));
      }
    }
    items.push({ description, qty, price });
  }
  if (!items.length) return null;
  const subtotal = money(/(?:order\s+)?subtotal:?\s*\$\s*([0-9,]+\.[0-9]{2})/i, body.replace(/\n/g, " "));
  const tax = money(/tax:?\s*\$\s*([0-9,]+\.[0-9]{2})/i, body.replace(/\n/g, " "));
  const orderNumber = (body.replace(/\n/g, " ").match(/order number:?\s*(P\d{6,})/i) || [])[1] || "";
  const qtyTotal = items.reduce((a, it) => a + it.qty, 0);
  const evenUnit = subtotal > 0 ? subtotal / qtyTotal : 0;
  const taxFactor = subtotal > 0 && tax > 0 ? (subtotal + tax) / subtotal : 1;
  // Preorder confirmations show "Price" per unit; shipping notices only show the subtotal.
  const priced = items.every((it) => it.price > 0) && Math.abs(items.reduce((a, it) => a + it.price * it.qty, 0) - subtotal) <= 1;
  const confident = (priced || items.length === 1) && evenUnit > 0 && Boolean(orderNumber);
  return {
    kind: "purchase",
    source: source.key,
    vendor: source.label,
    orderNumber,
    date,
    subject,
    totals: { subtotal, tax, shipping: 0, total: subtotal + tax },
    parseConfident: confident,
    parseNote: confident ? "" : "Pokemon Center only shows the order subtotal — cost was split evenly; set each item's price.",
    lines: items.map((it) => {
      const unit = priced ? it.price : evenUnit;
      return { description: it.description, qty: it.qty, unitPrice: round2(unit), unitCost: round2(unit * taxFactor) };
    }),
  };
}

// ---------- sale parsing ----------

/** Sold singles carry card names / collector numbers; sealed product always names its form (box, display, ETB…). */
function looksLikeSingle(desc) {
  if (/\b(near mint|lightly played|moderately played|heavily played|damaged|foil|holo)\b|#\s?\d+|\b\d{1,3}\/\d{1,3}\b/i.test(desc)) {
    return true;
  }
  return !PRODUCT_WORDS.test(desc);
}

function closeBrackets(desc) {
  const s = String(desc || "").trim();
  const open = (s.match(/\(/g) || []).length - (s.match(/\)/g) || []).length;
  return open > 0 ? s + ")".repeat(open) : s;
}

function parseEbaySaleEmail(msg, settings) {
  const headers = msg.payload?.headers || [];
  const subject = getHeader(headers, "Subject");
  const date = toIsoDate(getHeader(headers, "Date"));
  const body = extractBodyFromPayload(msg.payload) || "";
  const text = `${subject}\n${body}`;
  const title =
    (subject.match(/made the sale(?: for)?[:\s]+(.+)$/i) || [])[1] ||
    (subject.match(/(?:your item sold|item sold|sold)[:!\s-]+(.+)$/i) || [])[1] ||
    "";
  if (!title) return null;
  const qty = Math.max(1, Number((text.match(/quantity(?:\s+sold)?\s*:?\s*(\d{1,3})/i) || [])[1] || 1));
  const total = money(/(?:sold for|sale price|sold price|item price|price|sold)\s*:?\s*\$\s*([0-9,]+\.[0-9]{2})/i, text);
  const shipping = money(/shipping(?:\s+(?:paid|charged|cost))?\s*:?\s*\$\s*([0-9,]+\.[0-9]{2})/i, text);
  const orderNumber = (text.match(/\b(\d{2}-\d{5}-\d{5})\b/) || [])[1] || String(msg.id);
  const fees = total > 0 ? round2((total + shipping) * settings.ebayFeePercent + settings.ebayFeeFixed) : 0;
  return {
    kind: "sale",
    source: "ebay",
    vendor: "eBay",
    orderNumber,
    date,
    subject,
    feeBasis: `estimated (${round2(settings.ebayFeePercent * 100)}% + $${settings.ebayFeeFixed})`,
    parseConfident: total > 0,
    parseNote: total > 0 ? "" : "Could not read the sale price from the eBay email.",
    lines: [
      {
        description: title.trim(),
        qty,
        unitPrice: round2(total / qty),
        shipping,
        fees,
      },
    ],
  };
}

const PLATFORM_LABELS = { tcgplayer: "TCGplayer", ebay: "eBay", facebook: "Facebook", local: "In person", instore: "In person", cash: "In person" };

/**
 * One Orders-DB entry → a sale event. TCGplayer email orders carry line items; orders typed in on the
 * Order Tracking page (in-person, Facebook, manual eBay…) only have productName/quantity and no order number.
 */
export function orderDbSaleEvent(o) {
  const date = String(o.purchaseDate || "").slice(0, 10);
  if (!date || /cancel|refund/i.test(String(o.status || ""))) return null;
  const platform = String(o.platform || "tcgplayer").toLowerCase();
  const orderNumber = String(o.orderNumber || o.id || "").trim();
  if (!orderNumber) return null;
  let lines = (Array.isArray(o.lineItems) ? o.lineItems : [])
    .filter((li) => String(li.description || "").trim())
    .map((li) => ({ description: closeBrackets(li.description), qty: Math.max(1, Number(li.quantity || 1)) }));
  const genericName = /^tcgplayer order /i.test(String(o.productName || ""));
  if (!lines.length && String(o.productName || "").trim()) {
    lines = [{ description: closeBrackets(o.productName), qty: Math.max(1, Number(o.quantity || 1)) }];
  }
  if (!lines.length) return null;
  const isTcg = platform === "tcgplayer";
  const gross = Math.max(0, Number(o.orderAmount || o.salePrice || 0) - Number(o.buyerTax || 0));
  if (genericName && gross <= 0) return null;
  const vendor = PLATFORM_LABELS[platform] || (platform ? platform[0].toUpperCase() + platform.slice(1) : "Manual");
  // Manual eBay entries may duplicate a sale already logged from eBay's "You made the sale" email.
  const reviewNote = genericName
    ? "Order has no item names (imported from a CSV) — pick the item before it goes to the sheet."
    : !isTcg && platform === "ebay"
      ? "Manual eBay order — make sure the eBay sale email didn't already log it."
      : "";
  return {
    id: isTcg ? `tcgplayer:${orderNumber}` : `manual:${orderNumber}`,
    kind: "sale",
    source: isTcg ? "tcgplayer" : "manual",
    vendor: isTcg ? "TCGplayer" : `${vendor} (manual)`,
    orderNumber,
    date,
    subject: isTcg ? `TCGplayer order ${orderNumber}` : `${vendor} sale entered on the Orders page`,
    parseConfident: gross > 0 && !reviewNote,
    parseNote: gross <= 0 ? "Order total missing — sale price unknown." : reviewNote,
    orderGross: round2(gross),
    orderFees: round2(Number(o.feesActual ?? o.feeAmount ?? 0)),
    feeBasis: o.feesActual != null ? "actual" : isTcg ? "estimated" : Number(o.feeAmount) ? "entered" : "none",
    marketTax: isTcg ? Number(o.buyerTaxActual ?? 0) || undefined : undefined,
    ourTax: !isTcg && o.buyerTax != null ? Number(o.buyerTax) : undefined,
    labelCost: o.labelCost != null ? Number(o.labelCost) : undefined,
    // TCGplayer totals include buyer shipping (split out by rate table); manual entries are the item price.
    ...(isTcg ? {} : { shippingCharged: 0 }),
    lines,
  };
}

function orderDbSaleEvents(trackFrom, knownIds) {
  const out = [];
  for (const o of listOrders()) {
    if (String(o.purchaseDate || "").slice(0, 10) < trackFrom) continue;
    const ev = orderDbSaleEvent(o);
    if (ev && !knownIds.has(ev.id)) out.push(ev);
  }
  return out;
}

/**
 * Website orders know their exact prices, shipping and PayPal fee, so nothing is estimated.
 * Sealed lines carry the sheet title (matched to a stock row as usual); singles carry the card name
 * so the store's singles count (keyed by name) drops them.
 */
function webSaleEvents(knownIds) {
  return readWebOrders()
    // Zelle/Venmo orders become sales only once the owner marks them paid; test orders never do.
    .filter((o) => !knownIds.has(`web:${o.id}`) && isPaidOrder(o) && !o.test)
    .map((o) => {
      const product = o.lines.reduce((s, l) => s + l.price * l.qty, 0) || 1;
      const fee = Number(o.paymentFee ?? o.paypalFee ?? 0);
      return {
        id: `web:${o.id}`,
        kind: "sale",
        source: "web",
        orderNumber: o.id,
        date: new Date(o.paidAt || o.createdAt).toLocaleDateString("en-CA"),
        subject: o.channel ? `${o.channel} order ${o.id}` : `Website order ${o.id}`,
        parseConfident: true,
        vendor: `Website${o.channel && o.channel !== "Website" ? `/${o.channel}` : ""} (${o.paymentMethod || "paypal"})`,
        feeBasis: "actual",
        ourTax: Number(o.tax || 0),
        labelCost: o.shippingCost != null ? Number(o.shippingCost) : undefined,
        lines: o.lines.map((l, i) => ({
          description: l.single ? l.name : l.title,
          qty: l.qty,
          unitPrice: l.price,
          shipping: i === 0 ? o.shipping : 0,
          fees: round2((fee * l.price * l.qty) / product),
          ...(l.single ? { plan: { action: "single", locked: true } } : {}),
          // Custom decks have no Inventory26 row (data/custom-decks.json holds their stock): log the sale only.
          ...(isDeckId(l.id) ? { plan: { action: "log", locked: true }, soldItemId: `Web ${l.title}`, cost: deckCostFor({ id: l.id }) } : {}),
        })),
      };
    });
}

/** TCGplayer Marketplace price by card name from the latest seller export; singles have no sheet row to weight by. */
function listingPriceFor(description) {
  const name = String(description || "").toLowerCase().trim();
  const hit = getTcgplayerListings().listings.find((l) => l.condition !== "Unopened" && l.price > 0 && l.name.toLowerCase() === name);
  return hit ? hit.price : 0;
}

/**
 * Sale emails only carry the order total, which includes the buyer's shipping. The Sold tab's profit formula
 * subtracts "Shipping Charged", so it must be split out. Rates follow the TCGplayer order report: sealed orders
 * pay 6.99 under $50 of product, else the stock row's Calc Shipping (10.99 default); singles-only orders pay
 * 1.49 under $5 of product, else 1.27. The YTD report matched this on all but the odd big-case order.
 */
function estimateShipping(event) {
  const sealed = event.lines.filter((l) => l.plan?.action === "sell" || !looksLikeSingle(l.description));
  if (sealed.length) {
    if (event.orderGross - 6.99 < 50) return 6.99;
    return Math.max(...sealed.map((l) => Number(l.plan?.stockRow?.calcShipping) || 10.99));
  }
  return event.orderGross - 1.49 < 5 ? 1.49 : 1.27;
}

/** Split an order-level total/fees across lines, weighted by the matched row's Last Retail (or the TCGplayer listing price). */
function allocateOrderAmounts(event) {
  if (event.orderGross == null) return;
  const est = event.shippingCharged ?? estimateShipping(event);
  const ship = est < event.orderGross ? est : 0;
  const product = event.orderGross - ship;
  const weights = event.lines.map((l) => ((l.plan?.action === "sell" && l.match?.lastRetail) || listingPriceFor(l.description) || 1) * l.qty);
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  event.lines.forEach((l, i) => {
    const share = weights[i] / sum;
    l.unitPrice = round2((product * share) / l.qty);
    l.fees = round2(event.orderFees * share);
    l.shipping = i === 0 ? round2(ship) : 0;
  });
}

// ---------- planning ----------

async function planEvent(event, stockRows, settings) {
  for (const line of event.lines) {
    if (line.plan?.locked) continue;
    if (event.kind === "purchase") {
      let m = findBestRow(line.description, stockRows);
      let listing = null;
      if (!m.viaListing && !m.viaAlias) {
        listing = await lookupListing(line.description);
        if (listing) {
          line.listing = listing;
          const exact = findBestRow(line.description, stockRows, { productId: listing.productId, title: listing.title });
          if (exact.viaListing) m = exact;
        }
      }
      line.candidates = m.candidates;
      line.match = m.row ? { tab: m.row.tab, itemId: m.row.itemId, score: m.score, lastRetail: m.row.lastRetail } : null;
      const exactRow = m.viaListing || m.viaAlias;
      const alreadyEntered =
        m.row && m.row.tab === settings.purchaseTab && Number(m.row.qty) >= line.qty && Math.abs(Number(m.row.cost) - Number(line.unitCost)) <= 0.05;
      if (alreadyEntered && (exactRow || m.confident)) {
        line.plan = {
          action: "review",
          note: `Row "${m.row.itemId}" already has ${m.row.qty} at $${m.row.cost} — this order may already be entered. Choose Skip if so.`,
        };
      } else if (exactRow && m.row.tab === settings.purchaseTab) {
        line.plan = { action: "raise", targetItemId: m.row.itemId };
      } else if (exactRow) {
        line.plan = { action: "new", template: m.row };
      } else if (listing) {
        line.plan = {
          action: "new",
          newItemId: listing.title,
          template: { itemId: listing.title, link: listing.url, lastRetail: listing.marketPrice || undefined },
        };
      } else if (m.confident && m.row.tab === settings.purchaseTab) {
        line.plan = { action: "raise", targetItemId: m.row.itemId };
      } else if (m.confident) {
        line.plan = { action: "new", template: m.row };
      } else {
        line.plan = { action: "review" };
      }
    } else if (event.source === "ebay") {
      // eBay items are custom decks/bulk built from boxes opened on the channel: log the sale, never touch stock.
      line.plan = { action: "log" };
      line.soldItemId = line.soldItemId || `Ebay ${line.description}`;
      if (line.cost === undefined) line.cost = deckCostFor({ title: line.description });
    } else {
      const m = findBestRow(line.description, stockRows, { requireStock: true });
      line.candidates = m.candidates;
      line.match = m.row ? { tab: m.row.tab, itemId: m.row.itemId, score: m.score, lastRetail: m.row.lastRetail } : null;
      if (m.confident && Number(m.row.qty) >= line.qty) {
        line.plan = { action: "sell", stockRow: m.row };
      } else if (m.confident) {
        line.plan = { action: "review", note: `Sheet shows only ${m.row.qty} on hand.` };
      } else if (looksLikeSingle(line.description)) {
        line.plan = { action: "single" };
      } else {
        line.plan = { action: "review" };
      }
    }
  }
  if (event.kind === "sale") allocateOrderAmounts(event);
  const allPlanned = event.lines.every((l) => l.plan && l.plan.action !== "review");
  event.status = allPlanned && event.parseConfident ? "ready" : "needs_review";
}

async function applyEvent(event) {
  const results = [];
  let failed = false;
  // Order-level tax/label amounts go on the order's first line only, so sheet totals stay exact.
  const firstLine = event.lines.find((l) => l.plan?.action !== "skip");
  for (const line of event.lines) {
    const plan = line.plan || {};
    if (line.applied || plan.action === "skip" || plan.action === "review") continue;
    const first = line === firstLine;
    try {
      if (event.kind === "purchase") {
        const r = await applyPurchaseLine({
          description: line.description,
          qty: line.qty,
          unitCost: line.unitCost,
          targetItemId: plan.action === "raise" ? plan.targetItemId : null,
          createNew: plan.action === "new",
          newItemId: plan.newItemId,
          template: plan.template,
        });
        results.push(r);
      } else {
        const r = await applySaleLine({
          description: line.description,
          qty: line.qty,
          unitPrice: line.unitPrice,
          shipping: line.shipping,
          fees: line.fees,
          date: event.date,
          stockRow: plan.action === "sell" ? plan.stockRow : null,
          single: plan.action === "single",
          cost: line.cost,
          itemId: line.soldItemId,
          orderNumber: event.orderNumber,
          channel: event.vendor,
          feeBasis: event.feeBasis,
          marketTax: first ? event.marketTax : undefined,
          ourTax: first ? event.ourTax : undefined,
          labelCost: first ? event.labelCost : undefined,
        });
        results.push(...r);
      }
      line.applied = true;
    } catch (e) {
      failed = true;
      line.error = e.message;
    }
  }
  event.results = [...(event.results || []), ...results];
  const pending = event.lines.some((l) => !l.applied && l.plan?.action !== "skip");
  event.status = failed ? "error" : pending ? "needs_review" : "applied";
  event.appliedAt = new Date().toISOString();
  return event;
}

// ---------- gmail collection ----------

async function collectEmailEvents(settings, queue) {
  const token = await getValidAccessToken();
  const after = `after:${gmailDate(settings.trackFrom)}`;
  const seen = new Set(queue.seenMessageIds);
  const knownIds = new Set(queue.events.map((e) => e.id));
  // A store can send a confirmation and later a shipping notice for one order; count each purchase order once.
  const knownOrders = new Set(queue.events.filter((e) => e.kind === "purchase" && e.orderNumber).map((e) => e.orderNumber));
  const events = [];

  const sources = [
    ...PURCHASE_SOURCES,
    ...(settings.extraPurchaseSenders || []).map((d) => ({
      key: `other:${d}`,
      label: d,
      senders: [d],
      tcgOnly: true,
    })),
  ];

  // Outlook "Redirect" rules keep the original To header, so everything redirected from the store inbox is a purchase candidate.
  for (const inbox of settings.forwardedInboxes || []) {
    sources.push({
      key: `inbox:${inbox}`,
      label: `Store inbox (${inbox})`,
      // eBay sale notices are redirected here too; they're sales, handled by the eBay pass below.
      query: `to:(${inbox}) -from:(ebay.com) -subject:(shipped OR delivered OR "out for delivery" OR arriving OR arrive OR package OR review OR survey OR newsletter)`,
      tcgOnly: true,
    });
  }

  for (const source of sources) {
    const q = `${source.query || `from:(${source.senders.join(" OR ")}) ${PURCHASE_SUBJECT}`} ${after}`;
    const list = await gmailCollectMessages(token, q, { maxResults: 50, maxPages: 2 });
    for (const m of list) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      queue.seenMessageIds.push(m.id);
      const msg = await gmailGetMessage(token, m.id);
      const parsed = parsePurchaseEmail(msg, source);
      if (!parsed) continue;
      if (parsed.cancel) {
        events.push({
          id: `cancel:${m.id}`,
          kind: "notice",
          source: source.key,
          vendor: source.label,
          date: parsed.date,
          subject: parsed.subject,
          status: "needs_review",
          parseNote: "Cancellation/refund email — check whether the sheet needs a Qty correction.",
          lines: [],
        });
        continue;
      }
      const id = `${source.key}:${parsed.orderNumber || m.id}`;
      if (knownIds.has(id) || (parsed.orderNumber && knownOrders.has(parsed.orderNumber))) continue;
      knownIds.add(id);
      if (parsed.orderNumber) knownOrders.add(parsed.orderNumber);
      events.push({ id, messageId: m.id, ...parsed });
    }
  }

  // eBay sales before ebayTrackFrom were reconciled by hand from eBay's order report.
  const ebayAfter = `after:${gmailDate(settings.ebayTrackFrom || settings.trackFrom)}`;
  const ebayQ = `from:(ebay.com) subject:("You made the sale" OR "item sold" OR "Your item sold") ${ebayAfter}`;
  const ebayList = await gmailCollectMessages(token, ebayQ, { maxResults: 50, maxPages: 2 });
  for (const m of ebayList) {
    if (seen.has(m.id)) continue;
    queue.seenMessageIds.push(m.id);
    const msg = await gmailGetMessage(token, m.id);
    const parsed = parseEbaySaleEmail(msg, settings);
    if (!parsed) continue;
    const id = `ebay:${parsed.orderNumber}`;
    if (knownIds.has(id)) continue;
    knownIds.add(id);
    events.push({ id, messageId: m.id, ...parsed });
  }

  events.push(...orderDbSaleEvents(settings.trackFrom, knownIds));
  // Website sales go to the Sheet only from the lease holder; the cloud portal writes them when it holds the lease.
  if (pcLease.holdsLease()) events.push(...webSaleEvents(knownIds));
  return events;
}

// ---------- public API ----------

let running = false;

export async function runSheetIntake({ trigger = "manual" } = {}) {
  if (running) return { skipped: true, reason: "A sync is already running." };
  running = true;
  const settings = getSheetSyncSettings();
  const queue = readQueue();
  const summary = { at: new Date().toISOString(), trigger, newEvents: 0, applied: 0, needsReview: 0, errors: 0 };
  try {
    if (!hasSheetsScope()) throw new Error("Google Sheets access not granted yet. Click Connect Google on the Sheet Sync page.");
    try {
      await syncOrdersFromGmail({});
    } catch (e) {
      summary.gmailOrdersError = e.message;
    }
    let stockRows = await readStockRows();
    const fresh = (await collectEmailEvents(settings, queue)).sort(
      (a, b) => String(a.date).localeCompare(String(b.date)) || (a.kind === "purchase" ? -1 : 0) - (b.kind === "purchase" ? -1 : 0),
    );
    summary.newEvents = fresh.length;

    for (const ev of fresh) {
      ev.createdAt = new Date().toISOString();
      if (ev.kind !== "notice") await planEvent(ev, stockRows, settings);
      queue.events.push(ev);
      if (settings.autoApply && ev.status === "ready") {
        await applyEvent(ev);
        stockRows = await readStockRows();
      }
      if (ev.status === "applied") summary.applied += 1;
      else if (ev.status === "error") summary.errors += 1;
      else summary.needsReview += 1;
      writeQueue(queue);
    }
  } catch (e) {
    summary.error = e.message;
  } finally {
    queue.lastRun = summary;
    writeQueue(queue);
    running = false;
  }
  return summary;
}

export function getSheetIntakeState() {
  const q = readQueue();
  const events = [...q.events].sort((a, b) => String(b.createdAt || b.date).localeCompare(String(a.createdAt || a.date)));
  return {
    running,
    lastRun: q.lastRun,
    needsReview: events.filter((e) => e.status === "needs_review" || e.status === "error" || e.status === "ready"),
    recent: events.filter((e) => e.status === "applied" || e.status === "ignored").slice(0, 100),
  };
}

/**
 * Resolve a queued event from the review UI.
 * lines: [{ index, action: raise|new|sell|single|skip, targetItemId, newItemId, qty, unitCost, unitPrice, fees, shipping }]
 */
export async function resolveSheetEvent(eventId, { lines = [], apply = true } = {}) {
  const queue = readQueue();
  const ev = queue.events.find((e) => e.id === eventId);
  if (!ev) throw new Error("Event not found.");
  const settings = getSheetSyncSettings();
  const stockRows = await readStockRows();

  for (const edit of lines) {
    const line = ev.lines[edit.index];
    if (!line || line.applied) continue;
    for (const k of ["qty", "unitCost", "unitPrice", "fees", "shipping", "cost"]) {
      if (edit[k] !== undefined && edit[k] !== "") line[k] = Number(edit[k]);
    }
    if (edit.itemId) line.soldItemId = String(edit.itemId).trim();
    const action = edit.action;
    if (action === "raise" || action === "sell") {
      const row = stockRows.find(
        (r) => r.itemId === edit.targetItemId && (action === "sell" || r.tab === settings.purchaseTab)
      );
      if (!row) throw new Error(`Pick a sheet row for "${line.description}".`);
      rememberAlias(line.description, row.itemId);
      line.plan = action === "raise" ? { action, targetItemId: row.itemId, locked: true } : { action, stockRow: row, locked: true };
    } else if (action === "new") {
      const template = edit.targetItemId ? stockRows.find((r) => r.itemId === edit.targetItemId) : null;
      line.plan = { action, newItemId: edit.newItemId || line.description, template, locked: true };
    } else if (action === "single" || action === "skip" || action === "log") {
      line.plan = { action, locked: true };
    }
  }

  if (apply) {
    ev.parseConfident = true;
    await applyEvent(ev);
  }
  writeQueue(queue);
  return ev;
}

export function ignoreSheetEvent(eventId) {
  const queue = readQueue();
  const ev = queue.events.find((e) => e.id === eventId);
  if (!ev) throw new Error("Event not found.");
  ev.status = "ignored";
  ev.ignoredAt = new Date().toISOString();
  writeQueue(queue);
  return ev;
}

export const _parsers = { extractPurchaseLines, parsePurchaseEmail, parseEbaySaleEmail, webSaleEvents };

/** Read-only preview: collects and plans events from `since` without writing the sheet or the queue. */
export async function previewSheetIntake({ since } = {}) {
  const settings = { ...getSheetSyncSettings(), ...(since ? { trackFrom: since } : {}) };
  const scratch = { events: [], seenMessageIds: [] };
  const stockRows = await readStockRows();
  const events = await collectEmailEvents(settings, scratch);
  for (const ev of events) if (ev.kind !== "notice") await planEvent(ev, stockRows, settings);
  return events;
}

/** Compact status for the sidebar badge / banner on every portal page. */
export function getSheetSyncHealth() {
  const q = readQueue();
  const settings = getSheetSyncSettings();
  const reviewCount = q.events.filter((e) => e.status === "needs_review" || e.status === "error").length;
  const lastError = q.lastRun?.error || "";
  const loginProblem = !hasSheetsScope() || /expired|invalid_grant|not granted|reconnect|sign in again/i.test(lastError);
  return {
    enabled: settings.enabled,
    reviewCount,
    loginProblem,
    lastRunAt: q.lastRun?.at || null,
    lastError,
  };
}

let timer = null;
let lastLoginAlertDay = "";

export function startSheetSyncScheduler() {
  if (timer) clearTimeout(timer);
  const tick = async () => {
    const settings = getSheetSyncSettings();
    try {
      if (settings.enabled && hasSheetsScope()) {
        const r = await runSheetIntake({ trigger: "auto" });
        if (r.applied || r.needsReview || r.error) {
          console.log(`[sheet-sync] applied=${r.applied} review=${r.needsReview}${r.error ? ` error=${r.error}` : ""}`);
        }
        if (r.needsReview > 0) {
          notifyDesktop("PreEminent Portal — Sheet Sync", `${r.needsReview} new item(s) need a quick review before they go into the sheet.`);
        }
      }
      const health = getSheetSyncHealth();
      const today = new Date().toISOString().slice(0, 10);
      if (settings.enabled && health.loginProblem && lastLoginAlertDay !== today) {
        lastLoginAlertDay = today;
        notifyDesktop("PreEminent Portal — Google sign-in needed", "Sheet Sync is paused. Click here, then Connect Google to sign in as iv3nsun@gmail.com.");
      }
    } catch (e) {
      console.log(`[sheet-sync] ${e.message}`);
    }
    timer = setTimeout(tick, getSheetSyncSettings().intervalMinutes * 60 * 1000);
  };
  timer = setTimeout(tick, 2 * 60 * 1000);
}
