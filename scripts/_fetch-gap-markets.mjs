import fs from "fs";
import path from "path";

const TEMP = process.env.TEMP;
const partial = JSON.parse(fs.readFileSync(path.join(TEMP, "gap-prices-partial.json"), "utf8"));

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "application/json",
  "Content-Type": "application/json",
  Origin: "https://www.tcgplayer.com",
  Referer: "https://www.tcgplayer.com/",
};

const SEARCH = "https://mp-search-api.tcgplayer.com/v1/search/request";

async function marketForProductId(productId, hint) {
  const id = String(productId);
  if (!/^\d+$/.test(id)) return { market: null, note: "no TCG product id" };

  const body1 = { algorithm: "sales_exp_fields_experiment", from: 0, size: 24, filters: { term: {}, range: {}, match: {} } };
  // Prefer product listing endpoint
  const listingUrl = `https://mp-search-api.tcgplayer.com/v1/product/${id}/listings`;
  const listingBody = {
    filters: {
      term: { sellerStatus: "Live", channelId: 0 },
      range: { quantity: { gte: 1 } },
      exclude: { channelExclusion: 0 },
    },
    from: 0,
    size: 5,
    sort: { field: "price", order: "asc" },
  };

  // Search by product id path via public product details embedded in search
  const q = hint || id;
  try {
    const r1 = await fetch(SEARCH, {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({ q: String(q) }),
    });
    const j1 = await r1.json();
    const resultId = j1?.results?.[0]?.resultId;
    if (!resultId) {
      // fallback: try product page HTML via product endpoint
      return await marketFromProductPage(id);
    }
    const r2 = await fetch(SEARCH, {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({ q: String(q), resultId, from: 0, size: 48 }),
    });
    const j2 = await r2.json();
    const products = j2?.results?.[0]?.results || [];
    const exact = products.find((p) => String(p.productId) === id);
    const pick = exact || products[0];
    if (!pick) return await marketFromProductPage(id);
    const market =
      Number(pick.marketPrice) ||
      Number(pick.medianPrice) ||
      Number(pick.lowestPrice) ||
      null;
    return {
      market: Number.isFinite(market) && market > 0 ? market : null,
      note: exact ? "TCG search marketPrice" : "TCG search nearest hit",
      lowest: Number(pick.lowestPrice) || null,
      productId: pick.productId,
    };
  } catch (e) {
    return { market: null, note: String(e.message || e) };
  }
}

async function marketFromProductPage(id) {
  try {
    const r = await fetch(`https://www.tcgplayer.com/product/${id}`, {
      headers: {
        "User-Agent": HEADERS["User-Agent"],
        Accept: "text/html",
      },
    });
    const html = await r.text();
    // Look for JSON blobs
    const m1 = html.match(/"marketPrice"\s*:\s*([0-9.]+)/);
    if (m1) return { market: Number(m1[1]), note: "product HTML marketPrice" };
    const m2 = html.match(/Market Price[\s\S]{0,80}?\$([0-9,.]+)/i);
    if (m2) return { market: Number(m2[1].replace(/,/g, "")), note: "product HTML label" };
    return { market: null, note: "no market in product HTML" };
  } catch (e) {
    return { market: null, note: String(e.message || e) };
  }
}

// Prefer product-id match for costs from sheet
function parseMoney(s) {
  const n = Number(String(s || "").replace(/[$,]/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

function parseCsv(file) {
  const text = fs.readFileSync(`C:/Users/TheIv/LocalDev/TCG/data/imports/${file}`, "utf8");
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith(",,,") || line.startsWith("Item ID") || line.startsWith("Grand")) continue;
    const cols = [];
    let cur = "",
      q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        q = !q;
        continue;
      }
      if (c === "," && !q) {
        cols.push(cur);
        cur = "";
        continue;
      }
      cur += c;
    }
    cols.push(cur);
    rows.push({ name: cols[0], cost: parseMoney(cols[4]), link: cols[16] || "", file });
  }
  return rows;
}

function costFor(id, name, sheet) {
  if (/^\d+$/.test(id)) {
    const hits = sheet.filter((r) => r.link.includes(`/product/${id}/`) && r.cost > 0);
    if (hits.length) return hits.reduce((a, b) => (a.cost >= b.cost ? a : b));
  }
  // Mistveil / special ids: exact name fragment
  const n = String(name).toLowerCase();
  const hits = sheet.filter((r) => {
    const rn = String(r.name).toLowerCase();
    if (n.includes("mistveil") && rn.includes("mistveil")) return r.cost > 0;
    if (n.includes("omens") && rn.includes("omens") && rn.includes("third")) return r.cost > 0;
    return false;
  });
  if (hits.length) return hits.reduce((a, b) => (a.cost >= b.cost ? a : b));
  return null;
}

const sheet = [...parseCsv("Inventory26.csv"), ...parseCsv("Inventory25.csv")];

const out = [];
for (const row of partial) {
  const costRow = costFor(row.id, row.name, sheet);
  const m = await marketForProductId(row.id, row.name);
  // gentle pacing
  await new Promise((r) => setTimeout(r, 250));
  out.push({
    ...row,
    cost: costRow?.cost ?? null,
    costSource: costRow ? `${costRow.file}` : row.costSource,
    market: m.market,
    marketNote: m.note,
    lowest: m.lowest ?? null,
  });
  console.log(`${row.id} cost=${costRow?.cost ?? "?"} web=${row.website} mkt=${m.market} (${m.note})`);
}

fs.writeFileSync(path.join(TEMP, "gap-prices-full.json"), JSON.stringify(out, null, 2));
console.log("WROTE", out.length);
