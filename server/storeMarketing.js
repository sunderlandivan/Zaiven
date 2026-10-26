import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { CATALOG_PATH, STOCK_PATH } from "./storeCatalog.js";
import { readWebOrders } from "./webOrders.js";
import { notifyDesktop } from "./desktopNotify.js";
import { kvDelete, kvGetJson, kvList, kvPutMany } from "./cloudflareKv.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DRAFTS_PATH = path.join(ROOT, "data", "marketing-drafts.json");
const QUEUE_PATH = path.join(ROOT, "data", "sheet-sync-queue.json");
const INSIGHTS_STATE_PATH = path.join(ROOT, "data", "marketing-insights-state.json");
const MARKETING_URL = "http://localhost:5173/inventory-marketing.html";

function readJson(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return fallback;
  }
}

export const readDrafts = () => readJson(DRAFTS_PATH, { drafts: [] }).drafts;
const saveDrafts = (drafts) => fs.writeFileSync(DRAFTS_PATH, JSON.stringify({ drafts }, null, 2));

/** Move drafts the cloud agent dropped on the site into data/marketing-drafts.json. */
export async function pullMarketingDrafts() {
  const keys = await kvList("draft:");
  if (!keys.length) return { pulled: 0 };
  const drafts = readDrafts();
  const known = new Set(drafts.map((d) => d.id));
  let pulled = 0;
  for (const key of keys) {
    const d = await kvGetJson(key);
    if (!known.has(d.id)) {
      drafts.push({ ...d, status: "new" });
      known.add(d.id);
      pulled += 1;
    }
    saveDrafts(drafts);
    await kvDelete(key);
  }
  if (pulled) notifyDesktop("Marketing drafts ready", `${pulled} new post/idea draft(s) to review.`, MARKETING_URL);
  return { pulled };
}

/** statuses: new → approved | rejected → posted */
export function updateDraft(id, { status, body } = {}) {
  const drafts = readDrafts();
  const d = drafts.find((x) => x.id === id);
  if (!d) throw new Error("Draft not found.");
  if (status) {
    if (!["new", "approved", "rejected", "posted"].includes(status)) throw new Error("Bad status.");
    d.status = status;
    d[`${status}At`] = new Date().toISOString();
  }
  if (typeof body === "string" && body !== d.body) d.editedBody = body;
  saveDrafts(drafts);
  return d;
}

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * What the agent needs to market well, without access to the PC: what sells (all channels), what's in
 * stock and how deep, the lowest price that keeps the 10% profit rule, where web buyers come from,
 * and which of its past drafts were approved or rejected.
 */
export function buildInsights() {
  const catalog = readJson(CATALOG_PATH, { items: [] });
  const stock = readJson(STOCK_PATH, { items: {} });
  const events = readJson(QUEUE_PATH, { events: [] }).events || [];
  const day = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

  const sellers = new Map();
  const bySource = {};
  for (const e of events) {
    if (e.kind !== "sale" || e.status !== "applied" || String(e.date) < day(30)) continue;
    for (const l of e.lines || []) {
      const key = l.description;
      const s = sellers.get(key) || { item: key, qty: 0, revenue: 0, sources: {} };
      s.qty += Number(l.qty) || 0;
      s.revenue += (Number(l.unitPrice) || 0) * (Number(l.qty) || 0);
      s.sources[e.source] = (s.sources[e.source] || 0) + (Number(l.qty) || 0);
      sellers.set(key, s);
      bySource[e.source] = round2((bySource[e.source] || 0) + (Number(l.unitPrice) || 0) * (Number(l.qty) || 0));
    }
  }

  const web = readWebOrders().filter((o) => String(o.createdAt) >= day(90));
  const byRef = {};
  for (const o of web) {
    const r = (byRef[o.ref || "direct"] ||= { orders: 0, revenue: 0 });
    r.orders += 1;
    r.revenue = round2(r.revenue + o.subtotal);
  }

  const items = (catalog.items || []).map((i) => {
    const s = stock.items?.[i.id] || {};
    return {
      id: i.id,
      name: i.name,
      set: i.set,
      game: i.game,
      type: i.type,
      condition: i.condition || "Sealed",
      price: i.price,
      minPrice: s.f || null,
      qty: s.q ?? null,
      isNew: Boolean(i.addedRow),
      addedRow: i.addedRow || 0,
      url: `https://preeminentstore.com/p/${encodeURIComponent(i.id)}`,
      image: i.image ? `https://preeminentstore.com/${i.image}` : null,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    notes: [
      "minPrice is the lowest price that still makes 10% profit after fees; never suggest a sale price below it.",
      "qty is private: never mention exact stock in public posts. 'Low stock' / 'last few' is fine when qty <= 3.",
      "Sales sources: tcgplayer, ebay (custom/bulk items), web (preeminentstore.com).",
    ],
    shipping: catalog.shipping,
    salesLast30Days: { bySource, topSellers: [...sellers.values()].sort((a, b) => b.qty - a.qty).slice(0, 30).map((s) => ({ ...s, revenue: round2(s.revenue) })) },
    websiteOrdersLast90Days: { count: web.length, revenue: round2(web.reduce((a, o) => a + o.subtotal, 0)), byRef },
    items,
    draftFeedback: readDrafts()
      .filter((d) => d.status !== "new")
      .slice(-40)
      .map((d) => ({ type: d.type, title: d.title, status: d.status, edited: Boolean(d.editedBody) })),
    pendingDrafts: readDrafts().filter((d) => d.status === "new").length,
    recentDrafts: readDrafts()
      .slice(-60)
      .map((d) => ({ date: String(d.createdAt).slice(0, 10), type: d.type, title: d.title, status: d.status, videoId: d.videoId || undefined })),
  };
}

/** Push insights to the site for the agent when they changed (ignoring the timestamp). */
export async function pushMarketingInsights() {
  const { generatedAt, ...body } = buildInsights();
  const fingerprint = crypto.createHash("sha256").update(JSON.stringify(body)).digest("hex");
  const state = readJson(INSIGHTS_STATE_PATH, {});
  if (state.hash === fingerprint) return { pushed: false };
  await kvPutMany({ insights: JSON.stringify({ generatedAt, ...body }) });
  fs.writeFileSync(INSIGHTS_STATE_PATH, JSON.stringify({ hash: fingerprint, pushedAt: generatedAt }));
  return { pushed: true };
}
