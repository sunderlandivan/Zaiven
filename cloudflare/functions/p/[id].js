import { SITE, STORE_NAME, brandFor, describe, esc, googleCondition, imageUrl, isCustomDeckItem, loadCatalog, productUrl, shipFor } from "../../lib/catalog.js";

/**
 * Product pages are the store page with the product's own title, preview card (Open Graph) and
 * Google product data, so links shared on YouTube/Instagram and Google results show the item.
 *
 * Custom decks remain buyable here for direct visitors, but are noindex'd and omit Product
 * structured data so they are not presented to Google as Shopping/merchant products.
 */
export async function onRequestGet({ params, env, request }) {
  const page = await env.ASSETS.fetch(new URL("/", request.url));
  const catalog = await loadCatalog(env, request);
  const item = (catalog.items || []).find((i) => i.id === params.id);
  if (!item) return Response.redirect(new URL("/", request.url).href, 302);

  const price = Number(item.price).toFixed(2);
  const title = `${item.name} — $${price} | The PreEminent Store`;
  const desc = describe(item, catalog.shipping);
  const url = productUrl(item);
  const img = imageUrl(item);
  const brand = brandFor(item);
  const ship = shipFor(item, catalog.shipping || {});
  const customDeck = isCustomDeckItem(item);

  let head = `
    <link rel="canonical" href="${esc(url)}" />
    <meta property="og:type" content="${customDeck ? "website" : "product"}" />
    <meta property="og:title" content="${esc(title)}" />
    <meta property="og:description" content="${esc(desc)}" />
    <meta property="og:url" content="${esc(url)}" />
    <meta property="og:image" content="${esc(img)}" />
    <meta name="twitter:card" content="summary_large_image" />`;

  if (customDeck) {
    head += `
    <meta name="robots" content="noindex, nofollow" />`;
  } else {
    const ld = {
      "@context": "https://schema.org",
      "@type": "Product",
      name: item.title || item.name,
      image: img,
      description: desc,
      sku: item.id,
      ...(brand ? { brand: { "@type": "Brand", name: brand } } : {}),
      offers: {
        "@type": "Offer",
        url,
        price,
        priceCurrency: "USD",
        availability: "https://schema.org/InStock",
        itemCondition: googleCondition(item) === "new" ? "https://schema.org/NewCondition" : "https://schema.org/UsedCondition",
        seller: { "@type": "Organization", name: STORE_NAME, url: `${SITE}/` },
        ...(ship != null
          ? {
              shippingDetails: {
                "@type": "OfferShippingDetails",
                shippingRate: { "@type": "MonetaryAmount", value: Number(ship).toFixed(2), currency: "USD" },
                shippingDestination: { "@type": "DefinedRegion", addressCountry: "US" },
              },
            }
          : {}),
        hasMerchantReturnPolicy: {
          "@type": "MerchantReturnPolicy",
          applicableCountry: "US",
          returnPolicyCategory: "https://schema.org/MerchantReturnNotPermitted",
        },
      },
    };
    head += `
    <meta property="product:price:amount" content="${price}" />
    <meta property="product:price:currency" content="USD" />
    <script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>`;
  }

  const res = new HTMLRewriter()
    .on("title", { element: (e) => e.setInnerContent(title) })
    .on('meta[name="description"]', { element: (e) => e.setAttribute("content", desc) })
    .on('meta[property^="og:"], meta[name^="twitter:"], link[rel="canonical"]', { element: (e) => e.remove() })
    .on("head", { element: (e) => e.append(head, { html: true }) })
    .transform(page);
  return new Response(res.body, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300" } });
}
