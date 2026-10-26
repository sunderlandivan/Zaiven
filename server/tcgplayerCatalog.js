import axios from "axios";

const SEARCH_URL = "https://mp-search-api.tcgplayer.com/v1/search/request";
const DETAILS_URL = "https://mp-search-api.tcgplayer.com/v2/product";
const HEADERS = { "Content-Type": "application/json", Origin: "https://www.tcgplayer.com", "User-Agent": "Mozilla/5.0" };
const TRACKED_LINES = /magic|pokemon|flesh|weiss|riftbound/i;
// Store wording TCGplayer omits from product/set names (era prefixes, "display box", pack counts).
const LOOSE_WORDS = new Set(["mega", "evolution", "scarlet", "violet", "sword", "shield", "sun", "moon", "display", "packs", "pack", "exclusive", "english", "new"]);
const cache = new Map();

function slug(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function words(s) {
  return new Set(
    String(s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\(\s*\d+\s*packs?\s*\)/g, " ")
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter((w) => w && !["the", "of", "and", "a", "tcg", "pokemon", "magic", "gathering"].includes(w))
  );
}

export function productIdFromUrl(url) {
  const m = String(url || "").match(/tcgplayer\.com\/product\/(\d+)/i);
  return m ? Number(m[1]) : null;
}

/** Sheet naming convention: the TCGplayer listing title "Product Name - Set Name (CODE)". */
export function listingTitle(d) {
  return `${d.productName} - ${d.setName}${d.setCode ? ` (${d.setCode})` : ""}`;
}

export function listingUrl(d) {
  return `https://www.tcgplayer.com/product/${d.productId}/${slug(d.productLineUrlName)}-${slug(d.setUrlName)}-${slug(d.productUrlName)}?Language=English&page=1`;
}

const DETAILS_TTL_MS = 6 * 60 * 60 * 1000;

export async function productDetails(productId) {
  const key = `d:${productId}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < DETAILS_TTL_MS) return hit.d;
  const { data } = await axios.get(`${DETAILS_URL}/${productId}/details`, { headers: HEADERS, timeout: 15000 });
  const d = { ...data, productId: Number(productId) };
  cache.set(key, { at: Date.now(), d });
  return d;
}

export async function searchProducts(query, size = 12) {
  const key = `s:${query}`;
  if (cache.has(key)) return cache.get(key);
  const { data } = await axios.post(
    `${SEARCH_URL}?q=${encodeURIComponent(query)}&isList=false`,
    {
      algorithm: "sales_synonym_v2",
      from: 0,
      size,
      filters: { term: {}, range: {}, match: {} },
      listingSearch: { filters: { term: {}, range: {}, exclude: {} } },
      context: { cart: {}, shippingCountry: "US" },
      sort: {},
    },
    { headers: HEADERS, timeout: 15000 }
  );
  const results = (data.results?.[0]?.results || []).map((r) => ({ ...r, productId: Number(r.productId) }));
  cache.set(key, results);
  return results;
}

/**
 * Finds the TCGplayer sealed product a store/email description refers to.
 * Confident only when every word of the TCGplayer product name appears in the description;
 * among those, the most specific name wins (e.g. "Pokemon Center Elite Trainer Box" over "Elite Trainer Box").
 */
function queryVariants(description) {
  const base = String(description || "")
    .replace(/^(pok[eé]mon tcg|magic:? the gathering|flesh (and|&) blood( tcg)?|weiss schwarz)\s*[:\-–]\s*/i, "")
    .replace(/\s*-\s*(unopened|sealed)$/i, "")
    .replace(/\(\s*\d+\s*(packs?|boosters?)\s*\)/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  // Stores prefix the era ("Mega Evolution-", "Scarlet & Violet ") that TCGplayer leaves out of product names.
  const noSeries = base.replace(/^(mega evolution|scarlet (and|&) violet|sword (and|&) shield|sun (and|&) moon)\s*[-–:]?\s*/i, "").trim();
  const out = [base, noSeries];
  for (const v of [base, noSeries]) {
    if (/\b(booster )?display box\b/i.test(v)) out.push(v.replace(/\b(booster )?display box\b/i, "Booster Box"));
  }
  return [...new Set(out.filter((v) => v.length >= 6))];
}

export async function lookupListing(description) {
  const variants = queryVariants(description);
  let best = null;
  for (const q of variants) {
    let results;
    try {
      results = await searchProducts(q);
    } catch {
      continue;
    }
    const want = words(q);
    const fits = results
      .filter((r) => TRACKED_LINES.test(r.productLineName || r.productLineUrlName || ""))
      .map((r) => ({ r, w: words(r.productName), all: words(`${r.productName} ${r.setName}`) }))
      .filter(
        (x) =>
          x.w.size >= 2 &&
          [...x.w].every((w) => want.has(w)) &&
          [...want].every((w) => x.all.has(w) || LOOSE_WORDS.has(w) || /^\d+$/.test(w))
      )
      .sort((a, b) => b.w.size - a.w.size);
    if (!fits.length || (fits[1] && fits[1].w.size === fits[0].w.size)) continue;
    best = fits[0];
    break;
  }
  if (!best) return null;
  const fits = [best];
  try {
    const d = await productDetails(fits[0].r.productId);
    return {
      productId: d.productId,
      title: listingTitle(d),
      productName: d.productName,
      url: listingUrl(d),
      marketPrice: Number(d.marketPrice) || Number(fits[0].r.marketPrice) || 0,
    };
  } catch {
    return null;
  }
}
