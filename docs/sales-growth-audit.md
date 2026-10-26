# Sales growth audit: preeminentstore.com

Audited Oct 9, 2026. The site was checked read-only: nothing under `storefront/` or `cloudflare/` was changed and nothing was deployed or posted. Data comes from the live site, Google Merchant Center, Google Search Console, Cloudflare Web Analytics, and TCGplayer's public product data.

Screenshots are in `data/screenshots/`:
- `audit-search-console-product-not-indexed.png`: a product page that Google doesn't know about yet
- `audit-cloudflare-pageviews-7d.png`: last 7 days of traffic (launch spike, then a trickle)
- `audit-mobile-homepage-fullpage.png`: the phone homepage, where products start about 4 screens down
- `audit-checkout-desktop.png`: checkout works (PayPal, Venmo, Pay Later, card, direct Venmo/Zelle)

---

## Top 5 blockers

### 1. Website prices are higher than TCGplayer on 9 of every 10 sealed items

Website prices are copied from your own TCGplayer listing price, or from the sheet's "Last Retail" price when an item isn't listed. Those prices sit well above what TCGplayer buyers actually pay:

- **87 of 97** sealed products cost more on the site than TCGplayer's market price. 6 are about the same and 4 are cheaper.
- The **median site price is 1.45×** the TCGplayer market price.
- **18 products are listed at more than 2×** market. Examples: the 30th Celebration Pokémon Center ETB is $999.99 against a $286 market, and Chaos Rising Booster Box is $599.99 against $185.
- The flat $10.99 shipping adds to the gap on items under about $100.

TCG buyers check TCGplayer prices out of habit. Right now a visitor who compares will almost always find the site costs more, and that's very likely the main reason for zero orders. See the [price comparison](#price-comparison) below.

### 2. Very few people can find the site yet

- **Traffic:** 117 visits and 135 page views in the last 7 days. That includes a launch spike on Oct 6; since then it's about 5–15 visits a day. 80% of visits are "direct", which is mostly you, friends, and people typing the address. The rest came from the Google app (8), Instagram (8), Facebook (6), and Bing (1).
- **Google Search:** the homepage is indexed. Product pages are not: `/p/224730` shows "URL is unknown to Google", even though the sitemap was read successfully on Oct 7 and lists 308 URLs. Search Console has no performance data yet: 0 clicks.
- **Google Merchant Center** (free listings are turned on): 303 products, of which **59 are approved, 233 are still under review, and 11 are not approved** ("image not processed"; Google retries automatically and the image loads fine now). **0 product clicks in 28 days.**
- **Other search engines:** the domain doesn't appear in a general web search yet. Searching the store name mostly returns your TCGplayer seller page, your YouTube channel, and business-registry sites.

### 3. The homepage doesn't lead people to products

- **1.15 pages per visit, and only 4 product-page views in a week.** Almost every visitor sees the homepage and leaves. (Opening a product popup counts as a "soft navigation", so a few product views may be undercounted, but the overall pattern is clear.)
- **On a phone, the first product is about 4.3 screens down** (3,659 px). Visitors pass the hero, the "Shop by game" tiles, and more before seeing anything for sale. About 45% of visits are on mobile, and Instagram visitors arrive in the in-app browser.
- **Product cards aren't links.** They're `<article>` elements that open a popup through JavaScript, and the homepage has zero `<a href="/p/…">` links even after it loads. Google can't follow cards to product pages, which helps explain blocker 2.
- The product popup has price, set, condition, and shipping, but no short description, no "ships in 1–2 business days", and no reassurance next to the button (sealed, double-boxed, 700+ orders).

### 4. Merchant Center and search data gaps that limit Google visibility

- **Return policy mismatch.** Merchant Center says returns are "Free" (return window N/A). The site says "All sales are final", except damaged or wrong items reported within 3 days. Google treats mismatched policies as misrepresentation, which can get the whole account suspended. Fix this first.
- **No product identifiers.** The feed sends `identifier_exists=no` with no GTIN/UPC. Sealed products have UPCs, and without them Google can't match listings to its product pages, so they rank lower.
- Merchant Center flags **244 products** with "Add missing details", mainly descriptions.
- The product structured data on `/p/…` pages is valid but **missing `shippingDetails` and `hasMerchantReturnPolicy`**. Google uses those fields for merchant listings and rich results.
- **Google Customer Reviews** (free store rating and badge) isn't set up, and **there's no free-shipping threshold**. Merchant Center suggests both.

### 5. Your existing audiences are pointed somewhere else, and nothing brings visitors back

- The **YouTube channel description sends viewers to your TCGplayer storefront**, not the website. YouTube is your biggest owned audience.
- **No email or restock-alert signup**, so a first-time visitor who doesn't buy is gone for good.
- **No first-order incentive or website-only reason to buy.** Prices are the same or higher than TCGplayer, and there's no code field at checkout.

### Also worth fixing (speed and polish)

- **Hero image weight.** `brand/phoenix.png` is 577 KB and is the main image visitors wait for: median 0.7 s, but the slowest 10% of visits wait 12 seconds and the slowest 1% wait 20 seconds. The logo `brand/mark.png` is 160 KB. A first desktop visit downloads about 1.6 MB. Re-saving both as WebP should bring them to roughly 40–80 KB with no visible change.
- **Layout shift.** The top of the page jumps around as it loads: 11% of visits are rated "poor" and 30% "needs improvement" (`#top` scores up to 0.95, where under 0.1 is good). Reserving space for the hero card stack and the reviews bar fixes it.
- **Duplicate addresses.** `www.preeminentstore.com` serves the site with a 200 instead of redirecting to the main domain (canonical tags are correct, so this is minor). The sitemap lists `/info.html`, which permanently redirects to `/info`.
- **What's already working:** HTTPS, robots.txt, a valid sitemap, canonical tags, a valid Google feed (304 items), a flat-rate shipping policy in Merchant Center (2–5 days), clear shipping/returns/FAQ/contact pages, a business email, real customer reviews, and working checkout up to payment.

### Privacy note

Public business-registry sites (corpft.com, bizprofile.net) list the LLC's filing address, copied from the California Secretary of State record. That's a public record and can't be removed for free. So that nothing new links your home to the store: set up the Google Business Profile as a service-area business with the address hidden, and leave the ship-from address off the Merchant Center "Ship-from locations" list (it's empty now). A commercial registered agent would replace the address on future filings, but that's paid and optional. Your TCGplayer seller page also shows a city-level location; you can review that in TCGplayer seller settings.

---

## Price comparison

These are TCGplayer's public product data as of Oct 9, 2026. **Market** is TCGplayer's market price (recent sales). **TCG lowest delivered** is the cheapest current listing including shipping. **Site delivered** is the site price plus the $10.99 flat sealed shipping for a one-item order. **Floor** is the lowest price that still keeps your 10% profit rule (private; from `data/store-stock.json`).

| Product | Site | TCG market | TCG lowest delivered | Site delivered | Site vs market | Floor | Price to win on the site |
|---|---:|---:|---:|---:|---|---:|---:|
| Edge of Eternities Play Booster Display (MTG) | $169.99 | $192.35 | $194.99 | $180.98 | **12% cheaper** | — | keep it, and promote it |
| 2-pack Surging Twilight + token (PKM) | $29.99 | $36.79 | $43.99 | $40.98 | **18% cheaper** | — | keep it, and promote it |
| Pokémon Day 2026 Collection (PKM) | $36.99 | $38.07 | $38.49 | $47.98 | about the same (more expensive delivered) | — | free-shipping threshold helps |
| Bloomburrow Play Booster Display (MTG) | $199.99 | $202.95 | $195.00 | $210.98 | about the same | $154.65 | $184.99 |
| 30th Celebration Booster Bundle (PKM) | $84.99 | $69.93 | $70.00 | $95.98 | +22% | $36.81 | $64.99 |
| Delta Reign Booster Bundle (PKM) | $99.99 | $76.93 | $75.15 | $110.98 | +30% | $39.51 | $69.99 |
| Prismatic Evolutions Booster Bundle (PKM) | $99.99 | $86.51 | $87.50 | $110.98 | +16% | $40.05 | $79.99 |
| NIKKE Booster Box (Weiss) | $99.99 | $77.21 | $72.76 | $110.98 | +30% | $66.65 | $69.99 |
| 30th Celebration Elite Trainer Box (PKM) | $183.99 | $137.40 | $138.95 | $194.98 | +34% | $183.12 | can't beat without a loss |
| Usurp the Shadow Throne Booster Box (FaB) | $119.99 | $100.67 | $99.94 | $130.98 | +19% | $114.86 | can't beat without a loss |
| Secrets of Strixhaven Play Booster Display (MTG) | $184.99 | $142.08 | $141.49 | $195.98 | +30% | $176.65 | can't beat without a loss |
| Obsidian Flames Booster Box (PKM) | $529.99 | $366.27 | $381.83 | $540.98 | +45% | $498.89 | can't beat without a loss |
| Dual Impact Booster Box (Gundam) | $269.99 | $154.25 | $111.95 | $280.98 | +75% | $251.71 | can't beat without a loss |
| Chaos Rising Booster Box (PKM) | $599.99 | $184.71 | $180.99 | $610.98 | +225% | $339.71 | can't beat without a loss |
| Riftbound Arcane Box Set | $999.99 | $529.52 | $494.98 | $1,010.98 | +89% | $105.46 | $479.99 |
| 30th Celebration Pokémon Center ETB (PKM) | $999.99 | $286.24 | $271.99 | $1,010.98 | +249% | $79.58 | $259.99 |

**The fee math works in your favor.** A TCGplayer sale loses about 13% to fees; a website sale through PayPal loses about 3.5% plus $0.49. So a site price **about 10% below** your TCGplayer price earns roughly the same profit. For example, $100 on TCGplayer nets about $87, and $90 on the site nets about $86.40. Pricing the site **5–8% under the TCGplayer market price** (never below the floor) still earns more per sale than a TCGplayer sale at market.

**How to do it without changing site code:** the catalog already supports `priceOverrides` in `data/store-settings.json` (store item id → price; it can't go below the floor). An agent can generate that list for you to approve. About 30 sealed items have enough margin for this; the strongest are the bundles, the Pokémon Center ETBs, the Arcane Box Set, and the Final Fantasy and Tarkir collector displays. 67 items have a floor above 90% of market (they were bought high) and can't be undercut. For those, decide whether to hold them or sell slowly at market on TCGplayer.

**Decide on the "parked" items.** The 18 items at more than 2× market may be deliberate holds. If so, think about hiding them from the website (Status filter), because a $999.99 ETB on the homepage makes the whole store look overpriced to anyone who knows prices.

Singles are already competitive: 201 singles with a median price of $0.99 and $1.49 flat shipping for singles-only orders. That's a good hook for Flesh and Blood players.

TCGplayer and eBay don't appear to require matching prices with your own site, but check your current seller agreements. As before, **don't** use package inserts or messages to TCGplayer or eBay buyers to steer them to the site.

---

## Free advertising plan (in priority order)

Effort is your time. Impact is a rough estimate for a store at your stage. "You" means things that need your logins, judgment, or face; "agent" means work an agent can do here, with your approval where marked.

| # | Action | Effort | Impact | Who |
|---|---|---|---|---|
| 1 | **Give the site a reason to buy: website prices 5–8% under TCGplayer market** on the ~30 items with margin, plus "website price" wording in posts. Hide or reprice the 18 parked items. | 1 hr | **Very high** | Agent drafts the `priceOverrides` list; you approve; then publish |
| 2 | **Fix the Merchant Center return policy** to match the site: "no returns", with an exception for damaged or wrong items within 3 days. Then sign up for **Google Customer Reviews** (free) and add a **free-shipping threshold** if you choose one (see #6). | 20 min | High (protects the account and adds a trust badge) | You (Merchant Center → Shipping and returns) |
| 3 | **Point the YouTube channel at the site.** Change the channel description and About links to `https://preeminentstore.com/links?ref=youtube`; add `?ref=yt-<video>` links to new video descriptions and pinned comments. Instagram bio → `/links` (already done). | 15 min, then 1 min per video | High | You post; agent can draft the descriptions and pinned comments |
| 4 | **Help Google find the products.** In Search Console, use "Request indexing" on the homepage plus about 10 top product pages (`/p/619674`, `/p/609716`, `/p/704144`…). Recommended site changes (ask an agent when you're ready to allow site edits): make product cards real `<a href="/p/…">` links; add `shippingDetails` and `hasMerchantReturnPolicy` to product structured data; add GTIN/UPC to the feed; compress `phoenix.png` and `mark.png`; redirect `www` to the main domain; change `/info.html` to `/info` in the sitemap. | 15 min for you; about 2 hrs for the agent, later | High over 2–6 weeks | You (Search Console); agent (site changes, only with permission) |
| 5 | **Short-video engine: 3–4 posts a week** on Instagram Reels, TikTok, and YouTube Shorts (same clip on all three). Use the portal's Promo Shorts plus phone-shot rips and packing videos, and **only feature items that are actually good value** (see the table). | 2–3 hrs a week | High (the main free reach channel for TCG) | Agent makes the Promo Shorts and captions; you film rips and post |
| 6 | **Free shipping over a threshold** (for example $150) and a promo bar ("Website prices: below the marketplace") through the existing `shipping.freeOver` / `promoText` settings. No code change needed. | 10 min | Medium-high | You decide; agent sets it and publishes |
| 7 | **Google Business Profile** as an online, service-area business (address hidden, service area: United States, category "Trading card store", website `/?ref=gbp`). Description is drafted below. Then **Bing Places** (import from Google) and **Bing Merchant Center** (import the Google Merchant Center feed in a few clicks; covers Bing Shopping and Copilot). | 45 min total | Medium (brand searches, trust, Bing shopping) | You (needs your Google/Microsoft logins and verification) |
| 8 | **Restock-alert email list** with a free tool: **MailerLite** (free up to 1,000 subscribers, includes a hosted signup page so no site change is needed), **Brevo** (free, 300 emails a day), or **Mailchimp** (free up to 500 contacts). Put the hosted signup link on `/links`, in the Instagram bio, and in YouTube descriptions. Email when boxes restock or when you run a website-only price. | 1 hr setup, then 20 min a week | Medium, growing over time | You create the account; agent drafts emails. An on-site signup box needs site permission |
| 9 | **Referrals with the existing `?ref` links.** Give friends, local players, small streamers, and Discord mods their own tag (`?ref=alex`). The portal's "Came from" column shows who sends sales, and you can thank them with store credit or a free pack by hand. A **first-order code** needs a code field at checkout (site change); until then, use website-only prices and free shipping as the first-order hook. | 30 min | Medium | You hand out the links; agent can make the list of links |
| 10 | **Communities (no spam):** **Discord** (local and game-specific servers with #buy-sell channels; follow their rules), **Facebook groups** (TCG buy/sell groups on their allowed sale days; the Flesh and Blood singles post is drafted below), **Reddit** (help first; sell only in r/pkmntcgtrades or r/mtgmarketplace, following their format; approach drafted below), **local game stores and events** (Flesh and Blood Armory nights, Pokémon league: play, trade, hand out a card with a QR code to `/links?ref=lgs`; ask the store first and don't undercut them inside their store). | 1–2 hrs a week | Medium (slow, but these buyers come back) | You |
| 11 | **Pinterest** business account: claim the domain with a DNS TXT record in Cloudflare (no site code change), then connect the existing Merchant feed URL (`/feed.xml`) as a Pinterest catalog so product pins are created automatically. | 30 min | Low-medium (collectors browse there; pins last a long time) | You (login); agent can walk you through it |
| 12 | **Facebook Marketplace:** listings can't link out, and the site doesn't offer local pickup. Use it only if you want local cash sales of duplicates; it won't drive website orders. | — | Low for the website | Optional |

### Weekly posting calendar

Use one clip three ways: Reels, TikTok, and Shorts. Each post links to `/links` or a product with a `?ref` tag so the portal shows which ones sell.

| Day | Post | Source |
|---|---|---|
| Mon | Instagram/Facebook photo post: one good-value sealed item with price and flat shipping (draft: Pokémon Day 2026 Collection) | Product photo from the site |
| Tue | Reel / TikTok / Short: portal **Promo Short** for the week's best deal (draft: Edge of Eternities) | Portal → Marketing → Promo Shorts |
| Wed | Reel / TikTok: **packing video** or "what's new this week" (trust builder) | Phone, 15 s |
| Thu | Facebook group or Discord sale post (draft: Flesh and Blood singles) plus an Instagram story with a link sticker | Group rules permitting |
| Sat | **Pack-rip** Reel / TikTok / Short (draft: Surging Twilight 2-pack), cut from the YouTube rip or filmed fresh | YouTube rip clip |
| Sun | Instagram story recap: new arrivals, restock teaser, email signup link | Stories |

Of the 3 Promo Shorts already in the portal, the 30th Celebration ETB ($183.99 vs a $137 market) and Obsidian Flames ($529.99 vs a $366 market) would currently send bargain-hunters to overpriced items. Re-make them after repricing, or make new ones for Edge of Eternities and the Surging Twilight 2-pack.

---

## Drafts (also in the portal: Marketing → To review)

All 7 drafts below were added to `data/marketing-drafts.json` with status **"To review"**, so they appear in the portal's Marketing page for you to edit, approve, or reject. Nothing was published.

### 1. Instagram/Facebook post: Edge of Eternities display under market
Link: `https://preeminentstore.com/p/619674?ref=ig-post`

> Edge of Eternities Play Booster Display — $169.99 on our site 🚀
>
> That's below the going rate on the big marketplaces right now, and shipping is one flat $10.99 no matter how many sealed items you add.
>
> ✅ Factory sealed
> ✅ Double-boxed so corners arrive crisp
> ✅ Pay with PayPal, Venmo, card, or Zelle
>
> Link in bio → preeminentstore.com
>
> #mtg #magicthegathering #edgeofeternities #mtgsealed #boosterbox #tcg

### 2. Facebook post: Flesh and Blood singles from $0.99, $1.49 shipping
Link: `https://preeminentstore.com/?game=fab&ref=fb`

> Flesh and Blood players 👋 We just stocked ~90 FaB singles on our website, most at $0.99, with $1.49 flat shipping on singles-only orders (one charge, not per card).
>
> Filling out a Malice armory deck or chasing Usurp the Shadow Throne commons? Search the card name on the site and grab them all in one order:
> preeminentstore.com/?game=fab&ref=fb
>
> Sealed boxes ship for a flat $10.99. Questions? Drop them below.

### 3. Reel / TikTok / Short script: Surging Twilight 2-pack rip
Link: `https://preeminentstore.com/p/609716?ref=tiktok`

> HOOK (0–2 s, text on screen): "$29.99 for 2 packs + a token… worth it?"
> (0–2 s) Hands hold the sealed 2-pack to camera.
> (2–8 s) Quick rip, fan the cards, slow down on the best hit. Real reaction, no voiceover needed.
> (8–11 s) Text: "2 Pk Surging Twilight + token — $29.99"
> (11–13 s) Text: "preeminentstore.com · link in bio"
>
> CAPTION: Would you rip or keep? 2-pack Surging Twilight with token, $29.99 on our site (link in bio). #pokemontcg #pokemon #packopening #pokemoncards #tcg

### 4. Instagram/Facebook post: Pokémon Day 2026 Collection + stack your order
Link: `https://preeminentstore.com/p/668590?ref=ig-post`

> Pokémon Day 2026 Collection — $36.99 🎉
>
> Tip: our shipping is ONE flat rate per order ($10.99 for sealed), so stack it with an ETB or a booster bundle and shipping costs the same.
>
> Shop: link in bio → preeminentstore.com
>
> #pokemontcg #pokemonday #pokemoncards #pokemoncollector #tcg

### 5. TikTok / Reel script: How we pack a booster box (trust builder)
Link: `https://preeminentstore.com/?ref=tiktok`

> HOOK (0–2 s, text): "How your booster box ships from us 📦"
> (2–6 s) Box goes into a bubble sleeve, then into a snug inner box.
> (6–9 s) Inner box into the outer box with padding. Tap the corners.
> (9–12 s) Add the handwritten thank-you note + a bonus card.
> (12–15 s) Text: "700+ orders · 100% positive feedback · preeminentstore.com"
>
> CAPTION: Corners stay crisp. Every sealed order is double-boxed. Shop at preeminentstore.com (link in bio). #tcg #pokemontcg #mtg #fleshandblood #smallbusiness #packingorders
>
> Don't show shipping labels or addresses on camera.

### 6. Reddit approach (no ads)

- **Where selling is allowed** (read each sidebar first; most require account age or karma and a specific title format and flair): **r/pkmntcgtrades** (Pokémon) and **r/mtgmarketplace** (Magic). Sale posts need timestamped photos and prices.
- **Where it isn't:** r/PokemonTCG, r/magicTCG, r/mtgfinance, r/FleshandBlood, r/OnePieceTCG. No store links or promos. Contribute pull posts, set opinions, and packing tips, and put the store link in your Reddit profile only.
- **Ratio:** at least 9 helpful posts or comments for every 1 that mentions the shop.

Sample helpful post for r/FleshandBlood (no link):

> **Shipping sealed FaB boxes without dinged corners — what's worked for us**
>
> We've shipped a few hundred TCG orders and corner damage was our #1 complaint early on. What fixed it: (1) bubble sleeve around the shrink, (2) a snug inner box, (3) 2" of padding in the outer box, (4) never a padded mailer for boxes. Photos below. What do you all do for cases?

### 7. Google Business Profile description

Set it up as an online, service-area business: address hidden, service area United States, category "Trading card store" (or "Hobby store"), website `https://preeminentstore.com/?ref=gbp`.

> The PreEminent Store is an online trading card game shop selling factory-sealed Pokémon, Magic: The Gathering, Flesh and Blood, One Piece, Riftbound, Gundam and Weiss Schwarz products — booster boxes, Elite Trainer Boxes, booster bundles, collections and single cards. Every order is packed with care (sealed product is double-boxed) and ships with tracking within 1–2 business days. Simple flat-rate shipping: $10.99 for sealed product, $1.49 for single-card orders. Pay securely with PayPal, Venmo, debit/credit card or Zelle. Trusted by collectors with 700+ completed orders and 100% positive feedback. Watch our pack openings on YouTube (@thezaiven) and follow @thepreeminentstore on Instagram for new drops. Shop at preeminentstore.com.

(746 characters; the limit is 750, so add text only if you cut some.)

---

## What wasn't checked

- **Google Business Profile, Bing Webmaster Tools, Bing Merchant Center:** not opened. As far as I can tell they haven't been set up yet; see plan items 4 and 7.
- **Instagram, Facebook, TikTok, and YouTube analytics:** not opened. Check YouTube Studio → Analytics → Traffic source → External, and Instagram → Professional dashboard → link taps, to see how many people already click through.
- **Search Console page coverage:** still "Processing data". Check again in a few days under Indexing → Pages, and Performance → Search results → Queries.
- **Payment step:** checkout was tested up to the payment buttons only; no payment was made.
