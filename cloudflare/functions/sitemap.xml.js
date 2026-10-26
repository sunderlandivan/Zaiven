import { SITE, esc, isCustomDeckItem, loadCatalog, productUrl } from "../lib/catalog.js";

export async function onRequestGet({ env, request }) {
  const catalog = await loadCatalog(env, request);
  const day = String(catalog.updatedAt || new Date().toISOString()).slice(0, 10);
  // Custom decks stay shoppable on the site but are omitted from the sitemap so Google Shopping
  // reviewers are not steered to unofficial builds that use game branding (Counterfeit risk).
  const productUrls = (catalog.items || []).filter((i) => !isCustomDeckItem(i)).map(productUrl);
  const urls = [`${SITE}/`, `${SITE}/info`, `${SITE}/about`, `${SITE}/links`, ...productUrls];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${esc(u)}</loc><lastmod>${day}</lastmod></url>`).join("\n")}
</urlset>`;
  return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
