import fs from "fs";
import path from "path";
import { loadMarketingConfig } from "./load-config.mjs";

const { site, token, here } = loadMarketingConfig();

const get = async (apiPath, auth) => {
  const res = await fetch(site + apiPath, { headers: auth ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new Error(`${apiPath}: HTTP ${res.status}`);
  return res.json();
};

const insights = await get("/api/agent/insights", true);
const youtube = await get("/api/youtube");
const cacheDir = path.join(here, ".cache");
fs.mkdirSync(cacheDir, { recursive: true });
fs.writeFileSync(path.join(cacheDir, "insights.json"), JSON.stringify(insights, null, 2));
fs.writeFileSync(path.join(cacheDir, "youtube.json"), JSON.stringify(youtube, null, 2));

const items = insights.items || [];
const day = (iso) => String(iso).slice(0, 10);
const lines = [
  `Insights generated ${insights.generatedAt}. ${items.length} items in stock. Pending drafts awaiting review: ${insights.pendingDrafts}.`,
  `Shipping: sealed $${insights.shipping?.standard}, singles $${insights.shipping?.single}, free over: ${insights.shipping?.freeOver ?? "none"}.`,
  "",
  "Sales last 30 days by source ($):",
  JSON.stringify(insights.salesLast30Days?.bySource || {}),
  "Top sellers (30d):",
  ...(insights.salesLast30Days?.topSellers || [])
    .slice(0, 12)
    .map((s) => `  - ${s.item}: ${s.qty} sold, $${s.revenue} ${JSON.stringify(s.sources)}`),
  "",
  `Website orders (90d): ${insights.websiteOrdersLast90Days?.count} orders, $${insights.websiteOrdersLast90Days?.revenue}; by ref ${JSON.stringify(insights.websiteOrdersLast90Days?.byRef || {})}`,
  "",
  "Newest arrivals:",
  ...items
    .filter((i) => i.isNew)
    .sort((a, b) => b.addedRow - a.addedRow)
    .slice(0, 12)
    .map((i) => `  - [${i.id}] ${i.name} (${i.set}) $${i.price} min $${i.minPrice ?? "-"} qty ${i.qty}`),
  "",
  "Low stock (qty <= 3, sealed):",
  ...items
    .filter((i) => i.qty != null && i.qty <= 3 && i.condition === "Sealed")
    .slice(0, 15)
    .map((i) => `  - [${i.id}] ${i.name} $${i.price}`),
  "",
  "YouTube uploads (latest first):",
  ...(youtube.videos || [])
    .slice(0, 10)
    .map((v) => `  - ${day(v.published)} [${v.id}]${v.short ? " (Short)" : ""} ${v.title} — ${v.views} views`),
  "",
  "Recent drafts:",
  ...(insights.recentDrafts || [])
    .slice(-20)
    .map((d) => `  - ${d.date} ${d.type} [${d.status}] ${d.title}${d.videoId ? ` (video ${d.videoId})` : ""}`),
];
console.log(lines.join("\n"));
