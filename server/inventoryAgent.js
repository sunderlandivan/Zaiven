import fs from "fs";
import path from "path";
import xlsx from "xlsx";
import axios from "axios";

const DATA_DIR = path.resolve("data");
const INVENTORY_DB_PATH = path.join(DATA_DIR, "inventory-db.json");

/** TCGplayer marketplace search API (public JSON; two-step: resultId then products). */
const TCGPLAYER_SEARCH_API_URL = "https://mp-search-api.tcgplayer.com/v1/search/request";
/** HTTP timeout for each search request. */
const TCGPLAYER_TIMEOUT_MS = 12000;
const TCGPLAYER_HTTP_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Content-Type": "application/json",
  Accept: "application/json",
  Origin: "https://www.tcgplayer.com",
  Referer: "https://www.tcgplayer.com/",
};
/** Small pause between inventory rows during bulk refresh to reduce throttling. */
const BULK_REFRESH_DELAY_MS = 80;
/** Name-fit thresholds for search-only rows (no Excel TCG link). */
const SEARCH_HIGH_CONFIDENCE_MIN_FIT = 28;
const SEARCH_HIGH_CONFIDENCE_MIN_GAP = 14;
/** Max distinct search strings tried per item (ordered most-specific first). */
const MAX_LOOKUP_CANDIDATES = 14;
/** Cap search phrases per item when no Excel link — keeps bulk refresh practical. */
const MAX_SEARCH_CANDIDATES_PER_ITEM = 8;
const ORDERS_DB_PATH = path.join(DATA_DIR, "orders-db.json");
const WORKFLOW_DB_PATH = path.join(DATA_DIR, "inventory-workflow-db.json");

const DEFAULT_SETTINGS = {
  feeProfiles: {
    tcgplayer: { percentFee: 0.1275, fixedFee: 0.3 },
    ebay: { percentFee: 0.1325, fixedFee: 0.3 },
  },
  defaultShippingCost: 0,
  duplicateCostPolicy: "highest_cost",
};

function ensureDataFiles() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(INVENTORY_DB_PATH)) {
    fs.writeFileSync(
      INVENTORY_DB_PATH,
      JSON.stringify(
        {
          importedAt: null,
          sourceFilePath: null,
          settings: DEFAULT_SETTINGS,
          items: [],
        },
        null,
        2
      )
    );
  }
  if (!fs.existsSync(ORDERS_DB_PATH)) {
    fs.writeFileSync(ORDERS_DB_PATH, JSON.stringify({ orders: [] }, null, 2));
  }
  if (!fs.existsSync(WORKFLOW_DB_PATH)) {
    fs.writeFileSync(WORKFLOW_DB_PATH, JSON.stringify({ items: {} }, null, 2));
  }
}

function readJson(filePath) {
  ensureDataFiles();
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  ensureDataFiles();
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function normalizeName(raw) {
  return String(raw || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function parseMoney(value) {
  const cleaned = String(value ?? "")
    .replace(/[$,]/g, "")
    .trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function parseQty(value) {
  const n = Number(String(value ?? "").trim());
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.round(n));
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function buildLookupCandidates(rawName, itemType) {
  const base = String(rawName || "").trim();
  const lower = base.toLowerCase();
  const typeHint = String(itemType || "").toLowerCase().trim();
  const detectGame = () => {
    if (/\bpokemon|poke\b/.test(lower)) return "pokemon";
    if (/\bmagic|mtg\b/.test(lower)) return "magic";
    if (/\bfinal fantasy|ff\b/.test(lower)) return "final fantasy";
    if (/\bfab|flesh and blood\b/.test(lower)) return "flesh and blood";
    if (/\bgundam\b/.test(lower)) return "gundam";
    if (/\briftbound\b/.test(lower)) return "riftbound";
    return null;
  };
  const detectType = () => {
    if (/\bbooster box\b/.test(lower)) return "booster box";
    if (/\bbooster bundle\b/.test(lower)) return "booster bundle";
    if (/\betb|elite trainer box\b/.test(lower)) return "etb";
    if (/\bcollector|collectors\b/.test(lower)) return "collector box";
    if (/\bcommander|commanders\b/.test(lower)) return "commander deck";
    if (/\bplay box|play booster\b/.test(lower)) return "play booster box";
    if (/\bbundle\b/.test(lower)) return "bundle";
    return null;
  };
  const game = detectGame();
  const type = detectType();

  const stripped = lower
    .replace(/\bmagic\b/g, "")
    .replace(/\bpoke(mon)?\b/g, "pokemon")
    .replace(/\b(box|play|collector|collectors|bundle|booster|boosters|pack|pak|etb|pcetb|starter|kit|commanders?)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const compact = stripped.replace(/\s+/g, " ").trim();
  const words = compact.split(" ").filter(Boolean);
  const truncated = words.slice(0, 4).join(" ");
  const truncated3 = words.slice(0, 3).join(" ");
  const truncated5 = words.slice(0, 5).join(" ");
  const truncated6 = words.slice(0, 6).join(" ");

  const magicFriendly = base.replace(/^MAGIC\s+/i, "Magic ").replace(/\s+/g, " ").trim();
  const pokeFriendly = base.replace(/^Poke\s+/i, "Pokemon ").replace(/\s+/g, " ").trim();

  const gamePlusExcelType =
    game && typeHint ? `${game} ${typeHint}` : null;
  const gameTypeName =
    game && type && truncated ? `${game} ${type} ${truncated}` : null;
  const gameTypeNameShort =
    game && type && truncated3 ? `${game} ${type} ${truncated3}` : null;
  const excelTypePlusCore =
    typeHint && truncated ? `${truncated} ${typeHint}` : null;
  const excelTypePlusCore3 =
    typeHint && truncated3 ? `${truncated3} ${typeHint}` : null;

  const candidates = [
    base,
    magicFriendly !== base ? magicFriendly : null,
    pokeFriendly !== base && pokeFriendly !== magicFriendly ? pokeFriendly : null,
    typeHint ? `${base} ${typeHint}` : null,
    lower,
    typeHint ? `${lower} ${typeHint}` : null,
    compact,
    truncated,
    truncated3,
    truncated5,
    truncated6,
    gamePlusExcelType,
    gameTypeName,
    gameTypeNameShort,
    excelTypePlusCore,
    excelTypePlusCore3,
    game && type ? `${game} ${type}` : null,
    game ? `${game} tcg sealed` : null,
    compact ? `${compact} tcg` : null,
    compact ? `${compact} card game` : null,
    game && truncated5 ? `${game} ${truncated5}` : null,
    game && truncated3 ? `${game} ${truncated3}` : null,
    type && truncated ? `${type} ${truncated}` : null,
  ];
  return unique(candidates).slice(0, MAX_LOOKUP_CANDIDATES);
}

function detectColumns(headerRow) {
  const normalized = headerRow.map((h) => normalizeName(h));
  const idxByKeyword = (keywords) =>
    normalized.findIndex((h) => keywords.some((k) => h.includes(k)));

  const nameIdx = idxByKeyword(["name", "title", "product", "item"]);
  const qtyIdx = idxByKeyword(["qty", "quantity", "count", "stock"]);
  const costIdx = idxByKeyword(["cost", "unit cost", "purchase", "bought", "price paid"]);
  const typeIdx = idxByKeyword(["type", "item type", "product type", "format"]);
  let linkIdx = idxByKeyword([
    "tcg link",
    "product link",
    "listing url",
    "sheet link",
    "tcg url",
    "tcgplayer",
  ]);
  // Prefer column M when header matching misses; older sheets used column G.
  if (linkIdx < 0 && headerRow.length >= 13) linkIdx = 12;
  if (linkIdx < 0 && headerRow.length >= 7) linkIdx = 6;

  return {
    nameIdx: nameIdx >= 0 ? nameIdx : 0,
    qtyIdx: qtyIdx >= 0 ? qtyIdx : 1,
    costIdx: costIdx >= 0 ? costIdx : 2,
    typeIdx: typeIdx >= 0 ? typeIdx : -1,
    linkIdx: linkIdx >= 0 ? linkIdx : -1,
  };
}

function priceToNumber(text) {
  const matches = String(text || "").match(/\$?\s*([0-9]+(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)/g);
  if (!matches) return null;
  const nums = matches
    .map((m) => Number(m.replace(/[^0-9.]/g, "")))
    .filter((n) => Number.isFinite(n) && n > 0 && n < 100000);
  if (!nums.length) return null;
  return nums[0];
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
  return sorted[mid];
}

function buildTcgplayerSearchUrl(query) {
  const q = String(query || "").trim() || "tcg";
  return `https://www.tcgplayer.com/search/all/product?q=${encodeURIComponent(q)}`;
}

function normalizeTcgplayerHref(href) {
  if (!href || typeof href !== "string") return null;
  const t = href.trim();
  if (!t) return null;
  if (t.startsWith("/")) return `https://www.tcgplayer.com${t}`;
  try {
    const u = new URL(t.startsWith("//") ? `https:${t}` : t);
    const host = u.hostname.toLowerCase();
    if (!host.endsWith("tcgplayer.com")) return null;
    return u.toString();
  } catch (_e) {
    return null;
  }
}

/**
 * Stable TCGplayer product page: numeric ID path (slug-style URLs often 404 if segments mismatch).
 */
function buildTcgplayerProductUrlFromApiProduct(p) {
  if (!p || !Number.isFinite(Number(p.productId)) || Number(p.productId) <= 0) return null;
  return `https://www.tcgplayer.com/product/${p.productId}`;
}

/** Public CDN thumbnail used by TCGplayer product pages (verified 200 for numeric product ids). */
function buildTcgplayerProductImageUrl(productId) {
  const id = Number(productId);
  if (!Number.isFinite(id) || id <= 0) return null;
  return `https://product-images.tcgplayer.com/fit-in/200x200/filters:quality(80)/${id}.jpg`;
}

function tcgplayerListingMarketValue(p) {
  if (!p) return null;
  const m = Number(p.marketPrice);
  if (Number.isFinite(m) && m > 0) return m;
  const med = Number(p.medianPrice);
  if (Number.isFinite(med) && med > 0) return med;
  const low = Number(p.lowestPrice);
  if (Number.isFinite(low) && low > 0) return low;
  return null;
}

/** Words that match almost every sealed listing — ignored when scoring name fit. */
const TCG_MATCH_STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "for",
  "of",
  "in",
  "to",
  "at",
  "on",
  "magic",
  "mtg",
  "pokemon",
  "poke",
  "yugioh",
  "lorcana",
  "card",
  "cards",
  "tcg",
  "sealed",
  "booster",
  "box",
  "bundle",
  "etb",
  "pcetb",
  "deck",
  "pack",
  "packs",
  "elite",
  "trainer",
  "play",
  "collector",
  "collectors",
  "commander",
  "commanders",
  "sleeved",
  "sleeve",
  "display",
  "case",
  "half",
  "mini",
  "english",
  "japanese",
  "korean",
  "chinese",
  "set",
  "series",
  "product",
]);

function normalizeMatchText(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/spider[-\s]?man/gi, "spiderman")
    .replace(/marvel'?s?/gi, "marvel")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeInventoryHint(hint) {
  const n = normalizeMatchText(hint);
  return n.split(" ").filter((t) => t.length >= 2 && !TCG_MATCH_STOPWORDS.has(t));
}

/**
 * Higher = better semantic fit between API product row and your inventory line.
 * Penalizes hits that share only generic words (e.g. "bundle") but miss distinctive tokens ("spiderman").
 */
function scoreProductNameFit(product, inventoryHint) {
  const raw = [product.productName, product.productUrlName, product.setName, product.productLineName]
    .filter(Boolean)
    .join(" ");
  const haystack = normalizeMatchText(raw);
  const tokens = tokenizeInventoryHint(inventoryHint);
  if (!tokens.length) return 0;

  let score = 0;
  for (const tok of tokens) {
    const weight = 2 + tok.length * 0.35;
    if (haystack.includes(tok)) score += weight;
  }

  const distinctive = tokens.filter((t) => t.length >= 5);
  for (const tok of distinctive) {
    if (!haystack.includes(tok)) score -= 45;
  }

  const h = normalizeMatchText(inventoryHint);
  if (/\bpokemon|poke\b/.test(h)) {
    const pl = normalizeMatchText(product.productLineName || "");
    if (pl && !pl.includes("pokemon")) score -= 25;
  }
  if (/\bmagic|mtg\b/.test(h)) {
    const pl = normalizeMatchText(product.productLineName || "");
    if (pl && !pl.includes("magic")) score -= 25;
  }

  return score;
}

/**
 * Pick the listing row that best matches the inventory name (not necessarily API sort order).
 * @returns {{ best: object, bestFit: number, secondFit: number | null } | null}
 */
function pickBestMatchingProductWithScores(products, inventoryHint) {
  if (!Array.isArray(products) || !products.length) return null;
  const hint = String(inventoryHint || "").trim();
  const rows = products.map((p) => ({
    p,
    price: tcgplayerListingMarketValue(p),
    fit: scoreProductNameFit(p, hint),
    api: Number(p.score) || 0,
  }));

  const priced = rows.filter((r) => r.price != null);
  const pool = priced.length ? priced : rows;

  pool.sort((a, b) => {
    if (b.fit !== a.fit) return b.fit - a.fit;
    return b.api - a.api;
  });

  const first = pool[0];
  const second = pool[1];
  return {
    best: first?.p ?? products[0],
    bestFit: first?.fit ?? 0,
    secondFit: second?.fit ?? null,
  };
}

function pickBestMatchingProduct(products, inventoryHint) {
  return pickBestMatchingProductWithScores(products, inventoryHint)?.best ?? null;
}

/** Search hit is strong enough to stop trying more search phrases (rows without an Excel link). */
function isHighConfidenceSearchFit(fit, secondFit) {
  const f = Number(fit);
  if (!Number.isFinite(f)) return false;
  const s = secondFit == null ? null : Number(secondFit);
  if (f < SEARCH_HIGH_CONFIDENCE_MIN_FIT) return false;
  if (s == null || !Number.isFinite(s)) return true;
  return f - s >= SEARCH_HIGH_CONFIDENCE_MIN_GAP;
}

/**
 * Numeric product id from a tcgplayer.com product URL (path may include slug after id).
 */
function extractTcgplayerProductIdFromUrl(storedUrl) {
  try {
    const raw = String(storedUrl || "").trim();
    const u = new URL(raw.startsWith("//") ? `https:${raw}` : raw);
    if (!u.hostname.toLowerCase().endsWith("tcgplayer.com")) return null;
    const parts = u.pathname.split("/").filter(Boolean);
    const pi = parts.indexOf("product");
    if (pi < 0 || pi + 1 >= parts.length) return null;
    const seg = parts[pi + 1];
    if (/^\d+$/.test(seg)) return seg;
    const m = String(seg).match(/^(\d+)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/**
 * Resolve market price from a known TCGplayer product id via the same public search API (exact id match in results).
 */
async function fetchTcgplayerMarketFromSearchQueryByProductId(productId) {
  const q = String(productId);
  const cfg = { timeout: TCGPLAYER_TIMEOUT_MS, headers: TCGPLAYER_HTTP_HEADERS };

  const r1 = await axios.post(TCGPLAYER_SEARCH_API_URL, { q }, cfg);
  const resultId = r1.data?.results?.[0]?.resultId;
  if (!resultId) return { marketPrice: null, tcgplayerProductUrl: null, productId: null, imageUrl: null };

  const r2 = await axios.post(
    TCGPLAYER_SEARCH_API_URL,
    { q, resultId, from: 0, size: 36 },
    cfg
  );

  const products = r2.data?.results?.[0]?.results;
  if (!Array.isArray(products) || !products.length) {
    return { marketPrice: null, tcgplayerProductUrl: null, productId: null, imageUrl: null };
  }

  const exact = products.find((p) => String(p.productId) === String(productId));
  if (!exact) return { marketPrice: null, tcgplayerProductUrl: null, productId: null, imageUrl: null };

  const marketPrice = tcgplayerListingMarketValue(exact);
  const tcgplayerProductUrl =
    buildTcgplayerProductUrlFromApiProduct(exact) || `https://www.tcgplayer.com/product/${productId}`;
  const pid = Number(exact.productId);
  return {
    marketPrice,
    tcgplayerProductUrl,
    productId: Number.isFinite(pid) ? pid : null,
    imageUrl: buildTcgplayerProductImageUrl(exact.productId),
  };
}

async function fetchTcgplayerMarketFromSheetProductUrl(sheetUrl, inventoryHint = "") {
  const normalized = normalizeTcgplayerHref(sheetUrl);
  if (!normalized) return { marketPrice: null, tcgplayerProductUrl: null, productId: null, imageUrl: null };
  const id = extractTcgplayerProductIdFromUrl(normalized);
  if (!id) return { marketPrice: null, tcgplayerProductUrl: null, productId: null, imageUrl: null };
  const byId = await fetchTcgplayerMarketFromSearchQueryByProductId(id);
  if (Number.isFinite(byId.marketPrice) && byId.marketPrice > 0) return byId;

  // Strict exact fallback: query by full sheet URL, then accept ONLY the exact product id.
  // This preserves "no guessing" while recovering cases where id-only query returns 0 hits.
  try {
    const cfg = { timeout: TCGPLAYER_TIMEOUT_MS, headers: TCGPLAYER_HTTP_HEADERS };
    const r1 = await axios.post(TCGPLAYER_SEARCH_API_URL, { q: normalized }, cfg);
    const resultId = r1.data?.results?.[0]?.resultId;
    if (resultId) {
      const r2 = await axios.post(
        TCGPLAYER_SEARCH_API_URL,
        { q: normalized, resultId, from: 0, size: 36 },
        cfg
      );
      const products = r2.data?.results?.[0]?.results;
      if (Array.isArray(products) && products.length) {
        const exact = products.find((p) => String(p.productId) === String(id));
        if (exact) {
          const marketPrice = tcgplayerListingMarketValue(exact);
          if (Number.isFinite(marketPrice) && marketPrice > 0) {
            return {
              marketPrice,
              tcgplayerProductUrl: normalized,
              productId: Number(id),
              imageUrl: buildTcgplayerProductImageUrl(id),
            };
          }
        }
      }
    }
  } catch (_err) {
    // Keep strict behavior; return null market if exact match cannot be resolved.
  }

  // Final strict fallback: search by inventory text, but accept ONLY exact product id.
  const hint = String(inventoryHint || "").trim();
  if (hint) {
    try {
      const cfg = { timeout: TCGPLAYER_TIMEOUT_MS, headers: TCGPLAYER_HTTP_HEADERS };
      const r1 = await axios.post(TCGPLAYER_SEARCH_API_URL, { q: hint }, cfg);
      const resultId = r1.data?.results?.[0]?.resultId;
      if (resultId) {
        const r2 = await axios.post(
          TCGPLAYER_SEARCH_API_URL,
          { q: hint, resultId, from: 0, size: 36 },
          cfg
        );
        const products = r2.data?.results?.[0]?.results;
        if (Array.isArray(products) && products.length) {
          const exact = products.find((p) => String(p.productId) === String(id));
          if (exact) {
            const marketPrice = tcgplayerListingMarketValue(exact);
            if (Number.isFinite(marketPrice) && marketPrice > 0) {
              return {
                marketPrice,
                tcgplayerProductUrl: normalized,
                productId: Number(id),
                imageUrl: buildTcgplayerProductImageUrl(id),
              };
            }
          }
        }
      }
    } catch (_err) {
      // Keep strict behavior; return null market if exact match cannot be resolved.
    }
  }

  return {
    marketPrice: null,
    tcgplayerProductUrl: normalized,
    productId: Number(id),
    imageUrl: buildTcgplayerProductImageUrl(id),
  };
}

/**
 * TCGplayer marketplace search: POST twice (session resultId + paged hits with marketPrice).
 * @param searchQuery - string sent to TCGplayer search API (may be a shortened candidate).
 * @param inventoryHint - full product name + type from your sheet; used to pick the correct row among hits.
 */
async function fetchTcgplayerMarketFromSearchQuery(searchQuery, inventoryHint) {
  const q = String(searchQuery || "").trim();
  if (!q) {
    return {
      marketPrice: null,
      tcgplayerProductUrl: null,
      bestFit: null,
      secondFit: null,
      productId: null,
      imageUrl: null,
    };
  }

  const hint = String(inventoryHint || q).trim();

  const cfg = { timeout: TCGPLAYER_TIMEOUT_MS, headers: TCGPLAYER_HTTP_HEADERS };

  const r1 = await axios.post(TCGPLAYER_SEARCH_API_URL, { q }, cfg);
  const resultId = r1.data?.results?.[0]?.resultId;
  if (!resultId) {
    return {
      marketPrice: null,
      tcgplayerProductUrl: null,
      bestFit: null,
      secondFit: null,
      productId: null,
      imageUrl: null,
    };
  }

  const r2 = await axios.post(
    TCGPLAYER_SEARCH_API_URL,
    { q, resultId, from: 0, size: 36 },
    cfg
  );

  const products = r2.data?.results?.[0]?.results;
  if (!Array.isArray(products) || !products.length) {
    return {
      marketPrice: null,
      tcgplayerProductUrl: null,
      bestFit: null,
      secondFit: null,
      productId: null,
      imageUrl: null,
    };
  }

  const meta = pickBestMatchingProductWithScores(products, hint);
  if (!meta) {
    return {
      marketPrice: null,
      tcgplayerProductUrl: null,
      bestFit: null,
      secondFit: null,
      productId: null,
      imageUrl: null,
    };
  }
  const best = meta.best;

  let marketPrice = tcgplayerListingMarketValue(best);
  if (!marketPrice) {
    const values = products.map(tcgplayerListingMarketValue).filter((n) => n != null);
    marketPrice = values.length ? median(values.slice(0, 5)) : null;
  }

  const productUrl = buildTcgplayerProductUrlFromApiProduct(best);

  return {
    marketPrice,
    tcgplayerProductUrl: productUrl || buildTcgplayerSearchUrl(q),
    bestFit: meta.bestFit,
    secondFit: meta.secondFit,
    productId: best?.productId != null ? Number(best.productId) : null,
    imageUrl: buildTcgplayerProductImageUrl(best?.productId),
  };
}

/** Prefer a real TCGplayer URL; otherwise a TCGplayer search for the lookup query. */
function resolveTcgplayerSourceUrl(storedUrl, fallbackQuery) {
  const n = normalizeTcgplayerHref(storedUrl);
  if (n) return n;
  return buildTcgplayerSearchUrl(fallbackQuery);
}

function classifyGameTypeKey(name) {
  const n = String(name || "").toLowerCase();
  let game = "other";
  if (/\bpokemon|poke\b/.test(n)) game = "pokemon";
  else if (/\bmagic|mtg\b/.test(n)) game = "magic";
  else if (/\bfinal fantasy|ff\b/.test(n)) game = "final-fantasy";
  else if (/\bfab|flesh and blood\b/.test(n)) game = "fab";
  else if (/\bgundam\b/.test(n)) game = "gundam";
  else if (/\briftbound\b/.test(n)) game = "riftbound";

  let type = "sealed";
  if (/\bbooster box\b/.test(n)) type = "booster-box";
  else if (/\bbooster bundle\b/.test(n)) type = "booster-bundle";
  else if (/\betb|elite trainer box\b/.test(n)) type = "etb";
  else if (/\bcollector|collectors\b/.test(n)) type = "collector";
  else if (/\bcommander|commanders\b/.test(n)) type = "commander";
  else if (/\bplay box|play booster\b/.test(n)) type = "play-box";
  else if (/\bbundle\b/.test(n)) type = "bundle";
  return `${game}|${type}`;
}

function calcMetricsAtPrice(salePrice, costBasis, quantity, settings) {
  const mk = Number(salePrice || 0);
  if (!Number.isFinite(mk) || mk <= 0) return null;
  const shippingCost = Number(settings.defaultShippingCost || 0);
  const calc = (platform) => {
    const profile = settings.feeProfiles[platform];
    const feeAmount = mk * profile.percentFee + profile.fixedFee;
    const netAfterFees = mk - feeAmount - shippingCost;
    const profit = netAfterFees - costBasis;
    const marginPct = (profit / mk) * 100;
    return { salePrice: mk, feeAmount, netAfterFees, profit, marginPct };
  };
  const tcg = calc("tcgplayer");
  const ebay = calc("ebay");
  const bestPlatform = tcg.profit >= ebay.profit ? "tcgplayer" : "ebay";
  const best = bestPlatform === "tcgplayer" ? tcg : ebay;
  return {
    tcg,
    ebay,
    best,
    bestPlatform,
    totalProfit: best.profit * quantity,
    totalFees: best.feeAmount * quantity,
    totalNet: best.netAfterFees * quantity,
  };
}

function evaluateItem(item, settings) {
  const signals = item.market || {};
  const tcgMarketPrice = signals.tcgplayerMarket ?? null;
  const sheetFallback = Boolean(signals.sheetFallbackUsed);
  const shippingCost = Number(settings.defaultShippingCost || 0);
  const costBasis = Number(item.unitCost || 0);

  const calc = (platform) => {
    const profile = settings.feeProfiles[platform];
    const platformSalePrice = platform === "tcgplayer" ? tcgMarketPrice ?? null : null;
    const hasMarketPrice = Number.isFinite(platformSalePrice) && platformSalePrice > 0;
    if (!hasMarketPrice) {
      return { salePrice: null, feeAmount: 0, netAfterFees: 0, profit: null, marginPct: null };
    }
    const feeAmount = platformSalePrice * profile.percentFee + profile.fixedFee;
    const netAfterFees = platformSalePrice - feeAmount - shippingCost;
    const profit = netAfterFees - costBasis;
    const marginPct = (profit / platformSalePrice) * 100;
    return { salePrice: platformSalePrice, feeAmount, netAfterFees, profit, marginPct };
  };

  const tcg = calc("tcgplayer");
  const ebay = { salePrice: null, feeAmount: 0, netAfterFees: 0, profit: null, marginPct: null };
  const bestPlatform = "tcgplayer";
  const best = tcg;

  return {
    ...item,
    metrics: {
      marketPrice: best.salePrice ?? tcgMarketPrice ?? null,
      marketPriceKnown: Number.isFinite(tcgMarketPrice) && tcgMarketPrice > 0,
      ebaySoldMedian: null,
      ebayActiveLowest: null,
      ebayLastSoldDate: null,
      tcgplayerMarketPrice: signals.tcgplayerMarket ?? null,
      sourceUrl: resolveTcgplayerSourceUrl(
        signals.sourceUrl,
        signals.lookupQueryUsed ?? signals.lookupQuery ?? item.productName
      ),
      sourceQuery: signals.lookupQueryUsed ?? signals.lookupQuery ?? item.productName,
      sourceLabel: signals.tcgplayerMarket
        ? sheetFallback
          ? "TCGplayer (Excel link)"
          : "TCGplayer (search)"
        : "No TCG match",
      pricingSource: sheetFallback ? "excel-link" : "search",
      productImageUrl: signals.imageUrl || null,
      tcgplayer: tcg,
      ebay,
      bestPlatform,
      bestProfitPerUnit: best.profit,
      bestMarginPct: best.marginPct,
      totalBestProfit: Number.isFinite(best.profit) ? best.profit * item.quantity : null,
      bestFeePerUnit: Number.isFinite(best.feeAmount) ? best.feeAmount : null,
      bestNetAfterFeesPerUnit: Number.isFinite(best.netAfterFees) ? best.netAfterFees : null,
      totalEstimatedFees: Number.isFinite(best.feeAmount) ? best.feeAmount * item.quantity : null,
      totalEstimatedNetAfterFees: Number.isFinite(best.netAfterFees) ? best.netAfterFees * item.quantity : null,
      totalCostBasis: costBasis * item.quantity,
      totalEstimatedMarketValue:
        Number.isFinite(best.salePrice) && best.salePrice > 0 ? best.salePrice * item.quantity : null,
    },
  };
}

export function importInventoryFromExcel(filePath) {
  ensureDataFiles();
  if (!fs.existsSync(filePath)) {
    throw new Error(`Inventory file not found: ${filePath}`);
  }

  const workbook = xlsx.readFile(filePath);
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) throw new Error("Excel workbook has no sheets.");
  const sheet = workbook.Sheets[firstSheetName];
  const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });
  if (!rows.length) throw new Error("Excel sheet appears empty.");

  const [headerRow, ...dataRows] = rows;
  const { nameIdx, qtyIdx, costIdx, typeIdx, linkIdx } = detectColumns(headerRow.map((h) => String(h)));

  /** One inventory line per Excel data row (no merge by name) so every row is priced on refresh. */
  const items = [];
  for (let rowIndex = 0; rowIndex < dataRows.length; rowIndex++) {
    const row = dataRows[rowIndex];
    const rawName = String(row[nameIdx] ?? "").trim();
    if (!rawName) continue;

    const quantity = parseQty(row[qtyIdx]);
    const unitCost = parseMoney(row[costIdx]);
    const itemType = typeIdx >= 0 ? String(row[typeIdx] ?? "").trim() : "";
    const linkRaw = linkIdx >= 0 ? String(row[linkIdx] ?? "").trim() : "";
    const sheetProductUrl = normalizeTcgplayerHref(linkRaw) || null;
    if (!quantity) continue;

    const normalizedKey = normalizeName(rawName);
    items.push({
      id: `row_${rowIndex}`,
      productName: rawName,
      normalizedName: normalizedKey,
      itemType,
      quantity,
      unitCost,
      market: {
        soldMedian: null,
        activeLowest: null,
        lastSoldDate: null,
        tcgplayerMarket: null,
        lastCheckedAt: null,
        lookupQuery: rawName,
        overrideQuery: null,
        sheetProductUrl,
        sheetFallbackUsed: false,
        imageUrl: null,
      },
    });
  }

  const db = readJson(INVENTORY_DB_PATH);
  db.importedAt = new Date().toISOString();
  db.sourceFilePath = filePath;
  db.items = items;
  writeJson(INVENTORY_DB_PATH, db);

  return {
    importedAt: db.importedAt,
    itemCount: db.items.length,
    sourceFilePath: db.sourceFilePath,
  };
}

/**
 * Excel TCG Link column: sole source for product + market price (no marketplace search).
 */
async function fetchPriceSignalsFromExcelProductLink(rawQuery, itemType, sheetProductUrl) {
  const sheetNorm = normalizeTcgplayerHref(sheetProductUrl);
  const candidates = buildLookupCandidates(rawQuery, itemType);
  const fallbackFirst = candidates[0] || rawQuery;
  const excelProductId = sheetNorm ? extractTcgplayerProductIdFromUrl(sheetNorm) : null;
  const imageFromExcelId = buildTcgplayerProductImageUrl(excelProductId);
  const base = {
    soldMedian: null,
    activeLowest: null,
    lastSoldDate: null,
    tcgplayerMarket: null,
    usedCandidate: fallbackFirst,
    sourceUrl: sheetNorm || buildTcgplayerSearchUrl(fallbackFirst),
    bestFit: null,
    secondFit: null,
    sheetFallbackUsed: false,
    imageUrl: imageFromExcelId,
  };

  if (!sheetNorm) return base;

  try {
    const hint = [rawQuery, itemType].filter(Boolean).join(" ").trim();
    const sheetSig = await fetchTcgplayerMarketFromSheetProductUrl(sheetNorm, hint);
    if (sheetSig && Number.isFinite(sheetSig.marketPrice) && sheetSig.marketPrice > 0) {
      return {
        ...base,
        tcgplayerMarket: sheetSig.marketPrice,
        // Always keep the exact sheet URL as the source of truth.
        sourceUrl: sheetNorm,
        sheetFallbackUsed: true,
        imageUrl: sheetSig.imageUrl || imageFromExcelId || base.imageUrl,
      };
    }
  } catch (_e) {
    // No price; keep canonical product URL from Excel.
  }

  return {
    ...base,
    sourceUrl: sheetNorm,
  };
}

/**
 * When a row has no TCG Link in Excel, fall back to marketplace search (best-effort).
 */
async function fetchPriceSignalsFromSearchOnly(rawQuery, itemType) {
  const allCandidates = buildLookupCandidates(rawQuery, itemType);
  const candidates = allCandidates.slice(0, MAX_SEARCH_CANDIDATES_PER_ITEM);
  const fallbackFirst = candidates[0] || rawQuery;
  let best = {
    soldMedian: null,
    activeLowest: null,
    lastSoldDate: null,
    tcgplayerMarket: null,
    usedCandidate: fallbackFirst,
    sourceUrl: buildTcgplayerSearchUrl(fallbackFirst),
    bestFit: null,
    secondFit: null,
    sheetFallbackUsed: false,
    imageUrl: null,
  };

  const matchHint = [rawQuery, itemType].filter(Boolean).join(" ").trim();

  for (const candidate of candidates) {
    try {
      const sig = await fetchTcgplayerMarketFromSearchQuery(candidate, matchHint);
      const tcgMarket = sig.marketPrice;
      const tcgplayerProductUrl = sig.tcgplayerProductUrl;
      const hasPrice = Number.isFinite(tcgMarket) && tcgMarket > 0;
      const sigFit = sig.bestFit;
      const sigSecond = sig.secondFit;

      const better =
        hasPrice &&
        (!Number.isFinite(best.tcgplayerMarket) ||
          (Number.isFinite(sigFit) &&
            (best.bestFit == null ||
              !Number.isFinite(best.bestFit) ||
              sigFit > best.bestFit ||
              (sigFit === best.bestFit &&
                String(candidate).length < String(best.usedCandidate).length))));

      if (better) {
        const tcgUrl = tcgplayerProductUrl || buildTcgplayerSearchUrl(candidate);
        best = {
          soldMedian: null,
          activeLowest: null,
          lastSoldDate: null,
          tcgplayerMarket: tcgMarket,
          usedCandidate: candidate,
          sourceUrl: tcgUrl,
          bestFit: sigFit,
          secondFit: sigSecond,
          sheetFallbackUsed: false,
          imageUrl: sig.imageUrl || null,
        };
      }

      if (hasPrice && isHighConfidenceSearchFit(sigFit, sigSecond)) break;
    } catch (_err) {
      // Try next candidate.
    }
  }

  return best;
}

async function fetchPriceSignalsWithFallback(rawQuery, itemType, sheetProductUrl) {
  const sheetNorm = normalizeTcgplayerHref(sheetProductUrl);
  if (sheetNorm) {
    return fetchPriceSignalsFromExcelProductLink(rawQuery, itemType, sheetProductUrl);
  }
  return fetchPriceSignalsFromSearchOnly(rawQuery, itemType);
}

export async function refreshMarketData() {
  const db = readJson(INVENTORY_DB_PATH);
  const targets = db.items;

  for (let i = 0; i < targets.length; i++) {
    const item = targets[i];
    try {
      const lookupQuery = item.market.overrideQuery || item.market.lookupQuery || item.productName;
      const sheetUrl = item.market.sheetProductUrl || null;
      const signals = await fetchPriceSignalsWithFallback(lookupQuery, item.itemType, sheetUrl);
      item.market.soldMedian = signals.soldMedian;
      item.market.activeLowest = signals.activeLowest;
      item.market.lastSoldDate = signals.lastSoldDate;
      item.market.tcgplayerMarket = signals.tcgplayerMarket;
      item.market.lookupQueryUsed = signals.usedCandidate;
      item.market.sourceUrl =
        signals.sourceUrl ||
        buildTcgplayerSearchUrl(signals.usedCandidate || lookupQuery);
      item.market.sheetFallbackUsed = Boolean(signals.sheetFallbackUsed);
      item.market.imageUrl = signals.imageUrl ?? null;

      // Hard lock: when the spreadsheet provides a TCG URL, always preserve that exact URL as source.
      if (sheetUrl) {
        const canonicalSheetUrl = normalizeTcgplayerHref(sheetUrl);
        if (canonicalSheetUrl) item.market.sourceUrl = canonicalSheetUrl;
        const sheetProductId = extractTcgplayerProductIdFromUrl(canonicalSheetUrl || sheetUrl);
        const sheetImage = buildTcgplayerProductImageUrl(sheetProductId);
        if (sheetImage) item.market.imageUrl = sheetImage;
      }
      item.market.lastCheckedAt = new Date().toISOString();
    } catch (_err) {
      item.market.lastCheckedAt = new Date().toISOString();
    }
    if (i < targets.length - 1 && BULK_REFRESH_DELAY_MS > 0) {
      await new Promise((r) => setTimeout(r, BULK_REFRESH_DELAY_MS));
    }
    writeJson(INVENTORY_DB_PATH, db);
  }

  return { refreshed: targets.length };
}

function tcgplayerProductUrlToIdOnly(storedUrl) {
  try {
    const url = new URL(storedUrl.trim());
    if (!url.hostname.toLowerCase().endsWith("tcgplayer.com")) return null;
    if (!url.pathname.startsWith("/product/")) return null;
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    const last = parts[parts.length - 1];
    if (/^\d+$/.test(last)) return `https://www.tcgplayer.com/product/${last}`;
  } catch (_e) {}
  return null;
}

/**
 * Rewrites legacy `market.sourceUrl` values (PriceCharting, old search path, slug product URLs) to current TCGplayer URLs.
 */
export function sanitizeLegacyPricechartingUrlsInInventory() {
  ensureDataFiles();
  const db = readJson(INVENTORY_DB_PATH);
  let changed = false;
  for (const item of db.items) {
    const u = item.market?.sourceUrl;
    if (typeof u !== "string" || !u) continue;
    let host = "";
    try {
      host = new URL(u.trim()).hostname.toLowerCase();
    } catch {
      continue;
    }
    if (host.includes("pricecharting")) {
      const fallback = item.market.overrideQuery || item.market.lookupQuery || item.productName;
      item.market.sourceUrl = buildTcgplayerSearchUrl(fallback);
      changed = true;
      continue;
    }
    if (host.endsWith("tcgplayer.com")) {
      if (u.includes("/search/product?") && !u.includes("/search/all/product")) {
        item.market.sourceUrl = u.replace("/search/product?", "/search/all/product?");
        changed = true;
        continue;
      }
      const idOnly = tcgplayerProductUrlToIdOnly(u);
      if (idOnly && idOnly !== u) {
        item.market.sourceUrl = idOnly;
        changed = true;
      }
    }
  }
  if (changed) writeJson(INVENTORY_DB_PATH, db);
}

export function getInventoryDashboard() {
  const db = readJson(INVENTORY_DB_PATH);
  const workflowDb = readJson(WORKFLOW_DB_PATH);
  const settings = db.settings || DEFAULT_SETTINGS;
  const evaluated = db.items.map((item) => {
    const workflow = workflowDb.items?.[item.id] || null;
    return {
      ...evaluateItem(item, settings),
      workflow,
    };
  });

  const totals = evaluated.reduce(
    (acc, item) => {
      const qty = item.quantity;
      const costTotal = item.unitCost * qty;
      const marketTotal = (item.metrics.marketPrice || 0) * qty;
      const lineProfit = item.metrics.totalBestProfit;
      const profitTotal = Number.isFinite(Number(lineProfit)) ? Number(lineProfit) : 0;
      acc.units += qty;
      acc.costBasis += costTotal;
      acc.marketValue += marketTotal;
      acc.bestProfit += profitTotal;
      if (profitTotal > 0) acc.profitWinnersOnly += profitTotal;
      if (profitTotal < 0) acc.profitLosersOnly += profitTotal;
      if (item.metrics.marketPriceKnown) acc.pricedItems += 1;
      return acc;
    },
    {
      units: 0,
      costBasis: 0,
      marketValue: 0,
      bestProfit: 0,
      profitWinnersOnly: 0,
      profitLosersOnly: 0,
      pricedItems: 0,
    }
  );

  const recommendations = [...evaluated]
    .filter((i) => i.metrics.bestProfitPerUnit > 0)
    .sort((a, b) => b.metrics.totalBestProfit - a.metrics.totalBestProfit);

  return {
    importedAt: db.importedAt,
    sourceFilePath: db.sourceFilePath,
    totals,
    recommendations,
    items: evaluated,
    settings,
  };
}

export function resetInventoryAndWorkflowData() {
  ensureDataFiles();
  const inventoryDb = readJson(INVENTORY_DB_PATH);
  const workflowDb = readJson(WORKFLOW_DB_PATH);
  const clearedInventoryItems = Array.isArray(inventoryDb.items) ? inventoryDb.items.length : 0;
  const clearedWorkflowItems = Object.keys(workflowDb.items || {}).length;

  writeJson(INVENTORY_DB_PATH, {
    importedAt: null,
    sourceFilePath: null,
    settings: inventoryDb.settings || DEFAULT_SETTINGS,
    items: [],
  });
  writeJson(WORKFLOW_DB_PATH, { items: {} });

  return { clearedInventoryItems, clearedWorkflowItems };
}

export function resetOrdersData() {
  ensureDataFiles();
  const ordersDb = readJson(ORDERS_DB_PATH);
  const clearedOrders = Array.isArray(ordersDb.orders) ? ordersDb.orders.length : 0;
  writeJson(ORDERS_DB_PATH, { orders: [] });
  return { clearedOrders };
}

export function addOrder(orderInput) {
  const db = readJson(ORDERS_DB_PATH);
  const rawTax = orderInput.buyerTax ?? orderInput.buyerSalesTax;
  const buyerTax =
    rawTax != null && String(rawTax).trim() !== "" && Number.isFinite(Number(rawTax)) ? Number(rawTax) : undefined;
  const order = {
    id: `ord_${Date.now()}`,
    productName: String(orderInput.productName || "").trim(),
    quantity: Math.max(1, parseQty(orderInput.quantity || 1) || 1),
    salePrice: Number(orderInput.salePrice || 0),
    platform: String(orderInput.platform || "ebay").toLowerCase(),
    feeAmount: Number(orderInput.feeAmount || 0),
    shippingCost: Number(orderInput.shippingCost || 0),
    trackingNumber: String(orderInput.trackingNumber || "").trim(),
    noTrackingNeeded: Boolean(orderInput.noTrackingNeeded),
    purchaseDate: String(orderInput.purchaseDate || new Date().toISOString().slice(0, 10)),
    createdAt: new Date().toISOString(),
    ...(buyerTax != null && buyerTax >= 0 ? { buyerTax } : {}),
  };
  if (!Number(order.feeAmount) && isTcgplayerChannelOrder(order)) {
    const est = estimateTcgplayerMarketplaceFeeForOrder(order);
    if (est != null && est > 0) {
      order.feeAmount = est;
      order.feesAuto = true;
    }
  }
  db.orders.unshift(order);
  writeJson(ORDERS_DB_PATH, db);
  return order;
}

function parseOrderDateForStorage(v) {
  const t = String(v || "").trim();
  if (!t) return new Date().toISOString().slice(0, 10);
  const parsed = new Date(t);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return new Date().toISOString().slice(0, 10);
}

function parseOptionalTracking(text) {
  const t = String(text || "").trim();
  if (!t) return "";
  const urlM = t.match(/qtc_tLabels\d*=([A-Za-z0-9]+)/i);
  if (urlM) return urlM[1];
  const compact = t.replace(/\s+/g, "");
  const long = compact.match(/[A-Z0-9]{12,}/gi);
  if (long && long.length) return long.sort((a, b) => b.length - a.length)[0];
  const m = compact.match(/[A-Z0-9]{8,}/i);
  return m ? m[0] : "";
}

function parseCsvNumber(v) {
  const n = Number(String(v ?? "").replace(/[$,]/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

/** Level 1–4 marketplace commission (post Feb 2026 help-center rate). */
const TCG_L4_COMMISSION_RATE = 0.1075;
/** Domestic transaction fee: percent of order total (items + ship + buyer tax) + fixed. */
const TCG_L4_TRANSACTION_RATE = 0.025;
const TCG_L4_TRANSACTION_FIXED = 0.3;
/** Marketplace commission cap per physical product unit (USD). */
const TCG_L4_COMMISSION_CAP_PER_PRODUCT = 75;

function roundMoney(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 100) / 100;
}

/** TCGplayer documents banker's (round half to even) rounding for fee math. */
function bankersRoundMoney(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  const scaled = x * 100;
  const sign = scaled < 0 ? -1 : 1;
  const abs = Math.abs(scaled);
  const intPart = Math.floor(abs);
  const frac = abs - intPart;
  let roundedInt;
  if (Math.abs(frac - 0.5) < 1e-9) {
    roundedInt = intPart % 2 === 0 ? intPart : intPart + 1;
  } else {
    roundedInt = Math.round(abs);
  }
  return (sign * roundedInt) / 100;
}

/** `level4` (default) or `pro` / `marketplace_pro` — see TCGplayer Fees help. */
function getTcgFeeSellerProfile() {
  const raw = String(process.env.TCG_FEE_SELLER_PROFILE || process.env.TCG_MARKETPLACE_SELLER_PROFILE || "")
    .trim()
    .toLowerCase();
  if (raw === "pro" || raw === "marketplace_pro" || raw === "marketplace pro") return "marketplace_pro";
  return "level4";
}

function getTcgEstimatedBuyerTaxRate() {
  const v = Number(process.env.TCG_ESTIMATED_BUYER_TAX_RATE);
  if (Number.isFinite(v) && v >= 0 && v <= 0.5) return v;
  // Pro sellers: slightly higher default so processing leg matches typical buyer-tax states when tax is unknown.
  if (getTcgFeeSellerProfile() === "marketplace_pro") return 0.085;
  return 0.07;
}

function isTcgplayerChannelOrder(order) {
  const p = String(order?.platform || "").toLowerCase();
  if (p === "tcgplayer") return true;
  const ch = String(order?.channel || "").toLowerCase();
  return ch.includes("tcg");
}

function orderSubtotalPreTax(order) {
  const product = Number(order?.salePrice || 0);
  const ship = Number(order?.shippingCost || 0);
  return bankersRoundMoney(product + ship);
}

/**
 * Order total used for the 2.5% + $0.30 transaction leg (items + shipping + buyer sales tax).
 * Uses explicit buyerTax when present; otherwise if persisted orderAmount exceeds subtotal, treats
 * orderAmount as the charged total; else applies TCG_ESTIMATED_BUYER_TAX_RATE (default 7%) to subtotal.
 */
function tcgTransactionOrderTotal(order) {
  const sub = orderSubtotalPreTax(order);
  if (!(sub > 0)) return 0;
  const explicitTax = Number(order?.buyerTax ?? order?.buyerSalesTax);
  if (Number.isFinite(explicitTax) && explicitTax >= 0) {
    return bankersRoundMoney(sub + explicitTax);
  }
  const orderAmt = Number(order?.orderAmount || 0);
  if (orderAmt > sub + 0.02) {
    return bankersRoundMoney(orderAmt);
  }
  const rate = getTcgEstimatedBuyerTaxRate();
  return bankersRoundMoney(sub * (1 + rate));
}

function tcgMarketplaceCommissionOnProducts(productDollars, quantity) {
  const pd = Number(productDollars);
  const qty = Math.max(1, Math.floor(Number(quantity) || 1));
  if (!(pd > 0)) return 0;
  const unitPreTax = pd / qty;
  let sum = 0;
  for (let i = 0; i < qty; i += 1) {
    const piece = bankersRoundMoney(unitPreTax * TCG_L4_COMMISSION_RATE);
    sum += Math.min(piece, TCG_L4_COMMISSION_CAP_PER_PRODUCT);
  }
  return bankersRoundMoney(sum);
}

/** Level 1–4: help center uses subtotal × rate in one step; per-unit cap lowers high-ticket orders. */
function tcgLevel4CommissionTotal(order, sub, product, ship, qty) {
  const oneLine = bankersRoundMoney(sub * TCG_L4_COMMISSION_RATE);
  const shipComm = bankersRoundMoney(ship * TCG_L4_COMMISSION_RATE);
  const detailed = bankersRoundMoney(tcgMarketplaceCommissionOnProducts(product, qty) + shipComm);
  if (Math.abs(oneLine - detailed) < 0.05) return oneLine;
  return Math.min(oneLine, detailed);
}

/** Marketplace Pro (non-direct): 9.25% + 2.5% on order subtotal, each banker's-rounded (help examples). */
function tcgMarketplaceProCommissionTotal(sub) {
  const market = bankersRoundMoney(sub * 0.0925);
  const proFee = bankersRoundMoney(sub * 0.025);
  return bankersRoundMoney(market + proFee);
}

/**
 * Estimates TCGplayer marketplace fees (banker's rounding). Default profile is Level 1–4 (10.75% commission
 * on subtotal with per-unit $75 cap when binding, plus 2.5% + $0.30 on charged total including buyer tax).
 * Set TCG_FEE_SELLER_PROFILE=pro for Marketplace Pro (9.25% + 2.5% on subtotal + same transaction fee).
 * @see https://help.tcgplayer.com/hc/en-us/articles/201357836-TCGplayer-Fees
 */
export function estimateTcgplayerMarketplaceFeeForOrder(order) {
  if (!isTcgplayerChannelOrder(order)) return null;
  const product = Number(order?.salePrice || 0);
  const ship = Number(order?.shippingCost || 0);
  const sub = orderSubtotalPreTax(order);
  if (!(sub > 0)) return null;
  const qty = Math.max(1, Math.floor(Number(order?.quantity) || 1));
  const intl = Boolean(order?.international) || String(order?.country || "").toLowerCase() === "international";
  const txnRate = intl ? 0.035 : TCG_L4_TRANSACTION_RATE;
  const profile = getTcgFeeSellerProfile();

  const commissionTotal =
    profile === "marketplace_pro" ? tcgMarketplaceProCommissionTotal(sub) : tcgLevel4CommissionTotal(order, sub, product, ship, qty);

  const chargeTotal = tcgTransactionOrderTotal(order);
  const transactionFee = bankersRoundMoney(chargeTotal * txnRate + TCG_L4_TRANSACTION_FIXED);

  return bankersRoundMoney(commissionTotal + transactionFee);
}

function defaultTcgFeeAmountForOrder(order) {
  if (!isTcgplayerChannelOrder(order)) return null;
  return estimateTcgplayerMarketplaceFeeForOrder(order);
}

function legacyFlat15FeeGuess(order) {
  const sub = orderSubtotalPreTax(order);
  if (!(sub > 0)) return null;
  return roundMoney(sub * 0.15);
}

function applyDefaultTcgFeesToOrder(order) {
  if (!order) return false;
  const desired = defaultTcgFeeAmountForOrder(order);
  if (desired == null) return false;
  const cur = Number(order.feeAmount || 0);
  const sub = orderSubtotalPreTax(order);
  const legacy15 = legacyFlat15FeeGuess(order);
  const looksLegacy15 =
    legacy15 != null && cur > 0 && Math.abs(cur - legacy15) <= 0.02 && order.feesAuto !== false;
  const refreshAuto = order.feesAuto === true || (looksLegacy15 && order.feesAuto !== false);

  if (cur > 0 && !refreshAuto) return false;
  if (Math.abs(cur - desired) < 0.0001) return false;
  order.feeAmount = desired;
  order.feesAuto = true;
  order.updatedAt = new Date().toISOString();
  return true;
}

export function applyDefaultTcgFeesToAllOrders() {
  const db = readJson(ORDERS_DB_PATH);
  const orders = Array.isArray(db.orders) ? db.orders : [];
  let updated = 0;
  for (const o of orders) {
    if (applyDefaultTcgFeesToOrder(o)) updated += 1;
  }
  if (updated) writeJson(ORDERS_DB_PATH, db);
  return { updated, orders };
}

export function isLikelyStampShippingCost(shippingCost) {
  const s = Number(shippingCost || 0);
  if (!Number.isFinite(s)) return false;
  return s >= 1.2 && s <= 1.35;
}

function applyAutoStampHeuristicToOrder(order) {
  if (!order) return false;
  if (order.stampAuto === false) return false;
  if (order.noTrackingNeeded && !order.stampAuto) return false;
  const shouldStamp = isLikelyStampShippingCost(order.shippingCost);
  if (!shouldStamp) {
    if (order.stampAuto) {
      order.stampAuto = false;
      if (order.noTrackingNeeded) {
        order.noTrackingNeeded = false;
      }
      order.updatedAt = new Date().toISOString();
      return true;
    }
    return false;
  }
  if (order.noTrackingNeeded && order.stampAuto) return false;
  order.noTrackingNeeded = true;
  order.trackingNumber = "";
  order.stampAuto = true;
  order.updatedAt = new Date().toISOString();
  return true;
}

export function applyAutoStampHeuristicsToAllOrders() {
  const db = readJson(ORDERS_DB_PATH);
  const orders = Array.isArray(db.orders) ? db.orders : [];
  let updated = 0;
  for (const o of orders) {
    if (applyAutoStampHeuristicToOrder(o)) updated += 1;
  }
  if (updated) writeJson(ORDERS_DB_PATH, db);
  return { updated, orders };
}

export function listOrders() {
  ensureDataFiles();
  applyAutoStampHeuristicsToAllOrders();
  applyDefaultTcgFeesToAllOrders();
  const db = readJson(ORDERS_DB_PATH);
  return Array.isArray(db.orders) ? db.orders : [];
}

export function importOrdersFromCsv(filePath, { replaceExisting = false } = {}) {
  ensureDataFiles();
  if (!fs.existsSync(filePath)) {
    throw new Error(`Orders CSV not found: ${filePath}`);
  }

  const workbook = xlsx.readFile(filePath, { raw: false });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) throw new Error("CSV appears to have no sheets.");
  const sheet = workbook.Sheets[firstSheetName];
  const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });
  if (!rows.length) throw new Error("CSV appears empty.");

  const [headerRow, ...dataRows] = rows;
  const headers = headerRow.map((h) => normalizeName(h));
  const col = (keyword) => headers.findIndex((h) => h.includes(keyword));
  const idxOrder = col("order");
  const idxBuyer = col("buyer name");
  const idxOrderDate = col("order date");
  const idxChannel = col("channel");
  const idxStatus = col("status");
  const idxShippingType = col("shipping type");
  const idxProductAmt = col("product amt");
  const idxShippingAmt = col("shipping amt");
  const idxTotalAmt = col("total amt");
  const idxTaxAmt = ["tax", "sales tax", "buyer tax", "order tax"].map((k) => col(k)).find((i) => i >= 0) ?? -1;
  const carrierKeys = ["carrier information", "tracking number", "tracking id", "tracking", "ship tracking"];

  const db = readJson(ORDERS_DB_PATH);
  const existing = Array.isArray(db.orders) ? db.orders : [];
  const priorByOrder = new Map();
  for (const o of existing) {
    const k = String(o.orderNumber || "").trim();
    if (k) priorByOrder.set(k, o);
  }

  const mapped = [];
  for (const row of dataRows) {
    const orderNum = String(row[idxOrder] ?? "").trim();
    if (!orderNum) continue;
    let carrierRaw = "";
    for (const key of carrierKeys) {
      const i = col(key);
      if (i < 0) continue;
      const cell = String(row[i] ?? "").trim();
      if (cell) {
        carrierRaw = cell;
        break;
      }
    }
    let trackingNumber = parseOptionalTracking(carrierRaw);
    const prev = priorByOrder.get(orderNum);
    if (!trackingNumber && prev && String(prev.trackingNumber || "").trim()) {
      trackingNumber = String(prev.trackingNumber).trim();
    }
    let rawCarrierInfo = carrierRaw || null;
    if (!rawCarrierInfo && prev?.rawCarrierInfo) rawCarrierInfo = prev.rawCarrierInfo;

    const totalAmt = parseCsvNumber(row[idxTotalAmt]);
    const taxFromCsv = idxTaxAmt >= 0 ? parseCsvNumber(row[idxTaxAmt]) : 0;
    const isTcg = /tcg/i.test(String(row[idxChannel] ?? ""));
    const rowOrder = {
      id: `tcg_${orderNum}`,
      orderNumber: orderNum,
      buyerName: String(row[idxBuyer] ?? "").trim() || null,
      productName: `TCGplayer Order ${orderNum}`,
      quantity: 1,
      salePrice: parseCsvNumber(row[idxProductAmt]),
      platform: isTcg ? "tcgplayer" : "other",
      feeAmount: 0,
      shippingCost: parseCsvNumber(row[idxShippingAmt]),
      trackingNumber,
      noTrackingNeeded: false,
      purchaseDate: parseOrderDateForStorage(row[idxOrderDate]),
      status: String(row[idxStatus] ?? "").trim() || null,
      shippingType: String(row[idxShippingType] ?? "").trim() || null,
      channel: String(row[idxChannel] ?? "").trim() || null,
      orderAmount: totalAmt,
      rawCarrierInfo,
      createdAt: new Date().toISOString(),
      ...(taxFromCsv > 0 ? { buyerTax: taxFromCsv } : {}),
      ...(prev?.buyerTax != null && prev.buyerTax > 0 && !(taxFromCsv > 0) ? { buyerTax: prev.buyerTax } : {}),
      ...(prev?.lastEmailSyncAt ? { lastEmailSyncAt: prev.lastEmailSyncAt } : {}),
    };
    applyAutoStampHeuristicToOrder(rowOrder);
    mapped.push(rowOrder);
  }

  db.orders = replaceExisting ? mapped : [...mapped, ...existing];
  for (const o of db.orders) {
    applyAutoStampHeuristicToOrder(o);
    applyDefaultTcgFeesToOrder(o);
  }
  writeJson(ORDERS_DB_PATH, db);

  return {
    imported: mapped.length,
    totalOrders: db.orders.length,
    replaced: Boolean(replaceExisting),
  };
}

export function updateOrderTrackingStatus({ orderId, orderNumber, noTrackingNeeded }) {
  const db = readJson(ORDERS_DB_PATH);
  const orders = Array.isArray(db.orders) ? db.orders : [];
  const target = orders.find(
    (o) =>
      (orderId && String(o.id || "") === String(orderId)) ||
      (orderNumber && String(o.orderNumber || "") === String(orderNumber))
  );
  if (!target) throw new Error("Order not found.");
  target.noTrackingNeeded = Boolean(noTrackingNeeded);
  target.stampAuto = false;
  if (target.noTrackingNeeded) {
    target.trackingNumber = "";
  }
  target.updatedAt = new Date().toISOString();
  writeJson(ORDERS_DB_PATH, db);
  return target;
}

export function updateItemWorkflow({ itemId, action, platform, quantitySold, note }) {
  const safeItemId = String(itemId || "").trim();
  const safeAction = String(action || "").trim().toLowerCase();
  if (!safeItemId) throw new Error("itemId is required.");
  if (!["listed", "sold", "reset"].includes(safeAction)) throw new Error("action must be listed, sold, or reset.");

  const workflowDb = readJson(WORKFLOW_DB_PATH);
  const inventoryDb = readJson(INVENTORY_DB_PATH);
  const item = inventoryDb.items.find((x) => x.id === safeItemId);
  if (!item) throw new Error("Inventory item not found.");

  if (safeAction === "reset") {
    delete workflowDb.items[safeItemId];
  } else {
    workflowDb.items[safeItemId] = {
      status: safeAction,
      platform: String(platform || "").trim().toLowerCase() || null,
      quantitySold: parseQty(quantitySold || 0),
      note: String(note || "").trim() || null,
      updatedAt: new Date().toISOString(),
    };
  }

  if (safeAction === "sold") {
    const soldQty = parseQty(quantitySold || 1);
    item.quantity = Math.max(0, item.quantity - Math.max(1, soldQty));
  }

  writeJson(WORKFLOW_DB_PATH, workflowDb);
  writeJson(INVENTORY_DB_PATH, inventoryDb);

  return {
    itemId: safeItemId,
    workflow: workflowDb.items[safeItemId] || null,
    remainingQuantity: item.quantity,
  };
}
