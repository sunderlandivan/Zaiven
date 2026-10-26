import { SITE, allowInMerchantFeed, brandFor, describe, esc, googleCondition, imageUrl, loadCatalog, productUrl, shipFor } from "../lib/catalog.js";

const feedTitle = (i) => (i.title || i.name || "").slice(0, 150);

/** Google Merchant Center product feed (free listings). Add https://preeminentstore.com/feed.xml as a scheduled-fetch feed. */
export async function onRequestGet({ env, request }) {
  const catalog = await loadCatalog(env, request);
  const shipping = catalog.shipping || {};
  // Without a real photo the store logo would stand in as the product image, which Google treats as misleading.
  // Custom decks stay on the website only: Google Shopping treats unofficial/premade decks that use game
  // branding and card art as counterfeit risk, and Merchant Center suspended us for that (Oct 16, 2026).
  const items = (catalog.items || []).filter(allowInMerchantFeed).map((i) => {
    const ship = shipFor(i, shipping);
    const brand = brandFor(i);
    return `    <item>
      <g:id>${esc(i.id)}</g:id>
      <g:title>${esc(feedTitle(i))}</g:title>
      <g:description>${esc(`${i.title || i.name}. ${describe(i, shipping)}.`)}</g:description>
      <g:link>${esc(productUrl(i))}?ref=google</g:link>
      <g:image_link>${esc(imageUrl(i))}</g:image_link>
      <g:availability>in_stock</g:availability>
      <g:price>${Number(i.price).toFixed(2)} USD</g:price>
      <g:condition>${googleCondition(i)}</g:condition>
      ${brand ? `<g:brand>${esc(brand)}</g:brand>` : ""}
      <g:identifier_exists>no</g:identifier_exists>
      <g:product_type>${esc(["Trading Cards", i.type].filter(Boolean).join(" > "))}</g:product_type>
      ${ship != null ? `<g:shipping><g:country>US</g:country><g:price>${Number(ship).toFixed(2)} USD</g:price></g:shipping>` : ""}
    </item>`;
  });
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>The PreEminent Store</title>
    <link>${SITE}/</link>
    <description>Sealed trading card products and singles</description>
${items.join("\n")}
  </channel>
</rss>`;
  return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=1800" } });
}
