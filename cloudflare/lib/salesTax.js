// California sales tax for orders shipped to California. Rates come from data/store-settings.json "salesTax",
// pushed to KV inside "stock". The seller collects the statewide rate on every CA delivery, plus the district
// taxes of the districts it is engaged in business in when the ship-to address is inside them (CDTFA Pub 105,
// Regulation 1827). Other states: no tax. See docs/sales-tax.md.

const ppm = (rate) => Math.round(Number(rate || 0) * 1e6);
const zip5 = (zip) => String(zip || "").trim().slice(0, 5);
const norm = (s) => String(s || "").trim().toUpperCase().replace(/[^A-Z0-9 ]/g, "").replace(/\s+/g, " ");

const isTaxState = (cfg, to) => Boolean(cfg?.enabled) && norm(to?.state) === norm(cfg.state || "CA");

/** Without a CDTFA answer: the ZIP must be listed, and for a city district the mailing city must be that city. */
function districtsByZip(cfg, to) {
  const zip = zip5(to?.zip);
  const city = norm(to?.city);
  return (cfg.districts || []).filter((d) => (d.zips || []).map(String).includes(zip) && (!d.lookup?.city || !city || city === norm(d.lookup.city)));
}

/** With a CDTFA answer ({ city, county }): membership follows the official jurisdiction, never the ZIP. */
function districtsByJurisdiction(cfg, place) {
  return (cfg.districts || []).filter((d) => {
    const want = d.lookup || {};
    if (want.city) return norm(place.city) === norm(want.city);
    if (want.county) return norm(place.county) === norm(want.county);
    return false;
  });
}

/**
 * CDTFA's free rate-by-address service, used only to learn which city/county the address is in.
 * Cached in KV by normalized address. Returns { city, county, jurisdiction } or { error }.
 */
async function lookupPlace(env, cfg, to) {
  const opts = cfg.addressLookup || {};
  const key = `taxaddr:${[norm(to.line1), norm(to.city), zip5(to.zip)].join("|")}`;
  const cached = await env?.STORE?.get(key, "json").catch(() => null);
  if (cached) return { ...cached, cached: true };
  const url = new URL(opts.url || "https://services.maps.cdtfa.ca.gov/api/taxrate/GetRateByAddress");
  url.searchParams.set("address", String(to.line1).trim());
  url.searchParams.set("city", String(to.city || "").trim());
  url.searchParams.set("zip", zip5(to.zip));
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(Number(opts.timeoutMs) || 2000) });
    const data = await r.json().catch(() => ({}));
    const info = data.taxRateInfo?.[0];
    if (!r.ok || !info) return { error: data.errors?.[0]?.message || `HTTP ${r.status}` };
    // A fuzzy street match can land on a different address; only trust exact geocodes.
    if (data.geocodeInfo?.confidence !== "High") return { error: `geocode confidence ${data.geocodeInfo?.confidence || "unknown"}` };
    const place = { city: info.city, county: info.county, jurisdiction: info.jurisdiction, rate: info.rate };
    await env?.STORE?.put(key, JSON.stringify(place), { expirationTtl: (Number(opts.cacheDays) || 30) * 86400 }).catch(() => {});
    return place;
  } catch (e) {
    return { error: e.name === "TimeoutError" ? "timeout" : e.message };
  }
}

function compute(cfg, to, { subtotal, shipping }, districts, source) {
  const ratePpm = ppm(cfg.baseRate) + districts.reduce((s, d) => s + ppm(d.rate), 0);
  const taxable = subtotal + (cfg.taxShipping ? shipping : 0);
  return {
    cents: Math.round((taxable * ratePpm) / 1e6),
    rate: ratePpm / 1e6,
    taxable,
    state: norm(to?.state),
    zip: zip5(to?.zip),
    districts: districts.map((d) => ({ name: String(d.name), rate: Number(d.rate) })),
    source,
  };
}

const noTax = (to) => ({ cents: 0, rate: 0, taxable: 0, state: norm(to?.state), zip: zip5(to?.zip), districts: [], source: "none" });

/**
 * cfg: stock.salesTax; to: { state, zip, city?, line1? }; amounts in cents.
 * With a street address, district membership comes from CDTFA (falls back to city + ZIP if it fails);
 * without one (PayPal's address callback), from the city name + ZIP lists.
 * Returns { cents, rate, taxable, state, zip, districts: [{ name, rate }], source }.
 */
export async function salesTaxFor(env, cfg, to, amounts) {
  if (!isTaxState(cfg, to)) return noTax(to);
  if (String(to?.line1 || "").trim() && cfg.addressLookup?.enabled !== false) {
    const place = await lookupPlace(env, cfg, to);
    if (!place.error) return compute(cfg, to, amounts, districtsByJurisdiction(cfg, place), place.cached ? "address-cached" : "address");
    console.log(`[sales-tax] CDTFA lookup failed (${place.error}) for ZIP ${zip5(to.zip)}; using city + ZIP lists`);
    return compute(cfg, to, amounts, districtsByZip(cfg, to), "zip-fallback");
  }
  return compute(cfg, to, amounts, districtsByZip(cfg, to), "zip");
}

/** Short label for receipts, e.g. "Sales tax (CA 8.75%)". */
export function taxLabel(tax) {
  return `Sales tax (${tax.state} ${+(tax.rate * 100).toFixed(3)}%)`;
}

/** What an order record keeps: dollars, so the PC and the emails can use it as-is. */
export function taxRecord(tax) {
  return { tax: tax.cents / 100, taxInfo: { state: tax.state, zip: tax.zip, rate: tax.rate, taxable: tax.taxable / 100, districts: tax.districts, source: tax.source } };
}
