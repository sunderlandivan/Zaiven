# Merchant Center "Misrepresentation" suspension: diagnosis and fix plan

> **Status (Oct 13, 2026, 8:40 AM PT): site fixes approved by the owner and live.** Approved choices: "ships from California" (state only); both promises (cancel before shipping = full refund; no tracking movement for 10 days = replacement or refund; the "delivered but missing" wording was not approved and was left out); Near Mint singles stay "new"; business phone (Google Voice) **(951) 251-4699** is now live on the policies page (Contact + Business details) and About page, plus `telephone` in the About JSON-LD; no address or city anywhere. Verified live: feed has 333 items, all 37 decks `used` / brand "The PreEminent Store" / "(Unofficial)", the 7 logo-image items are excluded, 0 price changes across all 340 items, "Low stock" now follows real quantity (8 limited items lost the badge), Custom Decks section still present. Merchant Center was not touched.

Prepared Oct 13, 2026. Read-only audit. Nothing in Merchant Center was changed, no review was requested, no ID was submitted, and nothing on the website was deployed. No prices are changed by anything in this plan.

## 1. What Google says (read from Merchant Center, account 5871019770)

- **Overview:** "Your products aren't shown to customers. Fix Misrepresentation issue that prevents your products from showing on Google." **339 of 339 products are Not approved**, and Misrepresentation is the **only** reason listed for each one (Products > Needs attention: "Misrepresentation of business identity, business model, and policies is not allowed", 339 products, 100%). There are no other item-level problems.
- **Account issue page** (Products > Needs attention > View setup and policy issues):
  - "Misrepresentation. Prevents 171 products from showing in United States."
  - "Based on the information available about your business, there is reason to believe that customers are being misled on Google. Review the Misrepresentation policy and make changes to your Merchant Center and/or online store."
  - Google's checklist:
    1. Provide transparency about your business identity, business model, policies and how your customers can interact with you
    2. Promote your online reputation by showing reviews or highlighting any badges or seals of approval
    3. Use a professional design for your online store that includes an SSL certificate
    4. Provide information in the business information settings in your Merchant Center
    5. Follow SEO guidelines, improve your eligibility for seller ratings and match your product data in your Merchant Center with your online store
  - "**Google found this issue through automated checks.**"
  - The "I disagree with the issue" (review) button is **disabled** until you finish "**Verify your info before you request a review → Verify info**" (identity verification).
- **Business info > Details:** business name "The PreEminent Store", a street address (the LLC's filing address; it is not shown on the website), website preeminentstore.com **Verified + Claimed**. **There is no phone number and no customer-service contact (email, phone or URL) in Business info.** No payment methods listed.
- **Shipping:** one flat policy, 2–5 days, United States, all products. No ship-from location (good, keeps your address private).
- **Returns:** "Standard for United States", **Verified**, return window **Never**, applies to 339 products. This now matches the site's "All sales are final". (On Oct 9 it said "Free" returns, which conflicted with the site. Google's automated check may have seen that mismatch before you fixed it.)

## 2. What I checked on the live site and feed

| Check | Result |
|---|---|
| Site price vs feed price, all 340 items | **0 mismatches** |
| Product page JSON-LD price (sampled) | Matches feed and site |
| Feed availability | Every item `in_stock`; the catalog only contains in-stock items, so this is consistent |
| HTTPS, About, Shipping, Returns, Privacy, Terms, Contact pages | Present and linked from every footer |
| Checkout cost transparency | Shipping is shown in the cart. CA tax is shown before payment (PayPal re-prices by address; Zelle/Venmo show it while typing). Good |
| Fake discounts / strike-through prices / countdowns | None found. Promo bar is empty, `freeOver` is off |
| Contact methods | Email only. **No phone. No address of any kind (not even a state).** |

## 3. Likely causes, ranked

### 1. Thin business identity and contact info (high)
Google's first and fourth checklist items. Today a shopper (and Google's crawler) sees only an email address and Instagram/YouTube links. There's no phone, no state, and no "who runs this / online-only" statement. Merchant Center Business info also has **no customer-service contact at all**. This is the most common trigger for new stores, and the account is about a week old.

### 2. Custom decks are described to Google as new, factory-sealed, publisher-branded products (high)
- The feed and product JSON-LD send all 37 custom decks as **`condition: new`**, because their condition text "Near Mint · built by us" matches the "near mint → new" rule in `cloudflare/lib/catalog.js` (`googleCondition`).
- They're sent with **`brand: The Pokémon Company` / `Wizards of the Coast`** etc. Google reads that as "this is an official product made by that company". It isn't; you built it from opened cards.
- On the site, the FAQ says "**Everything is factory sealed**", the home page perk says "**Every product ships sealed exactly as it left the distributor**", and the product pop-up falls back to "**Factory sealed**" when an item has no condition. All three are false for the decks (and the singles).
- This is a direct match for "match your product data with your online store" and for misleading product claims.

### 3. Review display overstates the reviews (medium-high)
- Every review card shows a hard-coded **★★★★★** and "**Verified buyer**", and the page says "**Rave reviews**". The reviews are hand-picked text from TCGplayer feedback, which has no star ratings and wasn't verified on this site.
- Google wants reviews shown ("promote your online reputation"), but unverifiable star ratings and "verified" labels count as misleading trust signals.

### 4. False scarcity on limited items (medium)
- The 17 "limited items" are capped to show 1 unit. The "Low stock" badge is computed from that **shown** quantity (`server/storeCatalog.js`), so those items say "Low stock" even when you have more. The home page also says "What you see is what we have."
- Low stock on the other items (singles, one-of-a-kind decks) is truthful.

### 5. Policy gaps and the earlier return-policy mismatch (medium)
- Merchant Center said "Free" returns until recently, while the site said "All sales are final". Fixed now in Merchant Center, but it may be what tripped the automated check.
- The shipping page says "one flat rate" but doesn't list the custom-deck rate ($5.68), which the feed sends for decks.
- No sales-tax section in the policies (tax is only mentioned in the cart).
- No customer cancellation policy (only "unpaid orders cancel after 24h"), and no lost-package policy.

### 6. Off-platform payments to a personal payee (medium-low)
Direct Zelle/Venmo up to $2,500 without buyer protection, and (per the Oct 7 site review) Zelle goes to a personal email address, not the business one. Payment pages that look like they go to a person, not the business, are a scam signal for reviewers. Not a site-code issue; it's a settings choice.

### 7. Feed hygiene (low)
- 7 items have no photo, so the feed sends the **store logo** as the product image (Costco Poké Balls, the Japanese Mistveil box, 5 accessories).
- `identifier_exists=no` on sealed products that actually have UPCs. Not a suspension cause by itself, but adding GTINs later helps "match product data".
- Trademark notice in the footer doesn't list One Piece/Gundam, and doesn't say "not endorsed".
- `www.preeminentstore.com` serves a duplicate copy instead of redirecting (canonical tags are correct, so this is minor).

Things I checked that are **not** problems: prices match everywhere, no fake discounts, SSL is fine, return policy matches now, no "official" wording, the site uses no publisher logos (only text names), and having custom decks on eBay too is fine once they're labeled honestly.

## 4. Proposed site fixes (need your OK before deploy)

All changes are in **`docs/merchant-center-misrepresentation-2026-10-13.patch`** (8 files, about 95 lines). The site files aren't tracked in git, so this is a patch file rather than a branch. **No prices change.**

| # | File | Change |
|---|---|---|
| A | `cloudflare/lib/catalog.js` | Custom decks: `condition` → **used**; new `brandFor()` makes their brand **"The PreEminent Store"** instead of the game publisher; deck description says "assembled by The PreEminent Store from cards opened from booster packs. Not factory sealed and not an official product of [publisher]." |
| B | `cloudflare/functions/feed.xml.js` | Uses `brandFor()`. Deck titles get " - Custom Built Deck (Unofficial)". **Skips the 7 items with no photo** (333 of 340 stay in the feed until they get photos). |
| C | `cloudflare/functions/p/[id].js` | JSON-LD uses the same brand/condition as the feed, and adds `seller` (The PreEminent Store) and `shippingDetails` (same flat rate as the feed). |
| D | `server/storeCatalog.js` | "Low stock" is computed from the **real** quantity, not the limited-items display cap. (The cap of 1 and the price rule are unchanged.) Restart the portal after applying. |
| E | `storefront/store.js` | Deck pop-up says the cards are opened and it's not an official product; deck condition fallback "Opened cards, built by us" instead of "Factory sealed". Reviews: **no hard-coded stars, "TCGplayer buyer · YYYY-MM" instead of "Verified buyer"**, header "Selected feedback our TCGplayer buyers left for our seller account". |
| F | `storefront/index.html` | Removes the ★★★★★ / "rave reviews" banner wording ("Buyer feedback from TCGplayer"). Perk "Factory sealed / every product ships sealed" → "Described honestly" (sealed, singles by condition, decks built from opened cards). "What you see is what we have" → "Everything listed is in stock and ships from us." Deck intro says not factory sealed / not official. Meta description lists all games plus singles and decks. Footer trademark notice lists all games plus "not affiliated with, endorsed by or sponsored by them". |
| G | `storefront/info.html` | New **Sales tax** section (CA only, shown before you pay). **Cancellations** section (cancel for a full refund before shipping). Returns says "**No returns. All sales are final**" for all item types, and adds a **lost package** rule (no movement for 10 days or "delivered but missing" → replacement or refund). Shipping lists the custom-deck rate and "no other fees". FAQ "authentic" answer no longer claims everything is sealed. Contact adds **Business details**: The PreEminent Store LLC (California LLC), online-only, **ships from California** (state only, no city), also sells on TCGplayer/eBay. Phone line included but **commented out** until you have a number. |
| H | `storefront/about.html` | Adds Weiss Schwarz, a custom-deck paragraph, "online-only, ships from California", links to every policy, phone line commented out. JSON-LD adds `addressRegion: CA` (state only), a customer-service `contactPoint` and the no-returns policy. |

**Decisions in the patch that need your explicit OK:**
1. Showing "**ships from California**" and "California LLC" (state only, never the city). The site already charges CA tax, so the state is effectively public already. Delete those lines if you'd rather not.
2. The **lost-package** promise (10 days no movement → replacement or refund) and "**cancel any time before it ships**". These are new commitments; change the wording if you want different terms.
3. Custom decks listed on Google as **used** with your store as the brand. This is the honest classification; it may get slightly fewer clicks.
4. Keeping Near Mint singles as "new" (unchanged). Google's strict definition of "new" is "unopened original packaging", so the most cautious option is "used" for singles too. I left them as "new" because that's normal for card singles. Tell me if you want them switched.

**To apply after your OK** (from the repo root): `git apply -p2 docs/merchant-center-misrepresentation-2026-10-13.patch`, uncomment and fill in the phone lines once you have the number, restart the portal so it republishes the catalog, then deploy Cloudflare Pages as usual. Check `/feed.xml` (333 items, decks say `used`) and one `/p/deck-…` page.

## 5. What you need to do personally

1. **Get a free business phone number: Google Voice** (voice.google.com, free for US personal Google accounts). It forwards to your cell without exposing your number. Use it on the site (uncomment the lines in the patch) and in Merchant Center.
2. **Merchant Center → Settings → Business info → Edit business details:** add **customer service contact**: email `sales@preeminentstore.com`, the Google Voice phone, and the contact URL `https://preeminentstore.com/info#contact`. Keep the business name exactly "The PreEminent Store". The street address can stay there for verification. Merchant Center doesn't publish it on your listings, and you have no ship-from location, so it isn't shown to shoppers. **Don't add a ship-from location.**
3. **Address on the site:** not needed. Free options that don't expose your home: state-only ("ships from California"), which the patch adds. Free virtual addresses that are real are rare; a USPS PO Box costs money and a paid virtual mailbox isn't free, so I'm not recommending them.
4. **Zelle payee:** switch Zelle to the business email if your bank allows it. Otherwise consider turning direct Zelle off (PayPal/Venmo/card still work). Your call.
5. **Optional, helps the review:** Google Business Profile as an online, service-area business with the address **hidden** (see `docs/sales-growth-audit.md` item 7). Google Customer Reviews (free) for genuine on-site ratings later.
6. **Identity verification:** in Merchant Center, "Verify info" on the issue page. Google may ask for a government ID. **Do this yourself**; no agent should handle it. Use your legal name as it appears on the ID. Never send your SSN or full EIN to anyone other than Google's own verification form.

## 6. Recommended order (one review only)

1. Approve the site fixes (with any wording changes). Agent applies the patch, you get the Google Voice number, the phone lines get filled in, portal restarts, site deploys.
2. Wait for Google to re-fetch the feed (it fetches daily; you can click "Fetch now" in Data sources) and confirm decks show as **used** with brand "The PreEminent Store".
3. Update Merchant Center Business info (customer-service email, phone, URL). Change Zelle payee or disable direct Zelle if you choose.
4. Re-read the live site once: `/`, `/about`, `/info`, one sealed product, one deck. Everything should match the feed and Merchant Center.
5. **Then** do identity verification ("Verify info").
6. **Then** request **one** review ("I disagree with the issue"). Short note: "Updated our business identity and contact details (phone, customer service), clarified that custom decks are built from opened cards (now listed as used, under our own brand), removed unverifiable star ratings, corrected stock labels, and expanded our shipping, tax, returns, cancellation and lost-package policies."
7. If it's rejected, Google may impose a waiting period before the next review, which is why everything above comes first. Don't change the business name or domain while the review is pending.
