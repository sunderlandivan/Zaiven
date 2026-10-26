# Merchant Center Counterfeit suspension (Oct 16, 2026)

## What happened

Today at **11:57 AM PT**, Google Merchant Center sent two emails for account **The PreEminent Store (5871019770)**:

1. **Misrepresentation review completed** — that prior issue is cleared.
2. **Account suspended for Counterfeit product** — products are no longer promoted.

This is **not** TCGplayer, eBay, PayPal, or Gmail. It is **Google Merchant Center / Google Shopping free listings** only. The thank-you letter / package-insert website promo is unrelated to this suspension.

Google cites: [Counterfeit products policy](https://support.google.com/merchants/answer/6149993). Counterfeit is treated as an **egregious** violation (suspension without prior warning). Appeals only succeed in compelling cases after you remove or fix the flagged offers.

## Likely cause

The Shopping feed still included **37 custom-built decks** with titles like:

> Pokémon Gengar Premade Deck - Custom Built Deck (Unofficial)

Even with “Unofficial” and honest descriptions, those listings use **game brand names + official-looking card imagery**. Google’s counterfeit policy covers non-genuine products that mimic brand features. Custom decks are the only catalog slice that matches that pattern; sealed product and singles are authentic stock.

## What we fixed (done Oct 16, 2026 ~1:30 PM PT)

- `cloudflare/functions/feed.xml.js`: **exclude all custom decks** from `https://preeminentstore.com/feed.xml`.
- Decks remain for sale on preeminentstore.com (direct checkout only — not submitted to Google Shopping).
- Feed channel description no longer advertises custom decks to Google.
- Site **force-deployed**; live feed verified at **297 items, 0 decks** (was 334 with 37 decks).
- Merchant Center **Data sources → Update products now** run (last updated Oct 16, 2026 1:27 PM PT). UI may still show 334 until Google finishes expiring removed offers.
- **Review requested** in Merchant Center: “Review requested on Oct 16, 2026. It can take a few days to complete.” (Counterfeit account issue → I fixed the issue → Request review.)

## Appeal notes (no free-text box was offered)

Google only asked to confirm the issue was fixed. If they email for more detail, use:

> We sell only authentic, factory-sealed trading card products and genuine singles sourced from legitimate distributors and secondary markets. We do not sell replicas, proxies, fakes, or unauthorized branded merchandise.
>
> The likely source of confusion was our custom-built decks (assembled by us from opened booster packs). Those were previously included in our Google product feed with game names and “Unofficial” labeling. We have now **removed all custom decks from the Merchant Center product feed**. They are sold only on our website as clearly labeled unofficial builds and are no longer submitted to Google Shopping.
>
> Remaining feed items are authentic sealed products and singles. Please reinstate the account.

## Status check — Oct 20, 2026

- Merchant Center Diagnostics still shows **Counterfeit — Prevents all products from showing in United States** (manual check).
- Banner: **“Review requested on Oct 16, 2026. It can take a few days to complete.”** No new review-result email yet.
- Data sources: **297 products**, last fetch Oct 20, 2026 00:00 PDT; **Update products now** re-triggered Oct 20 AM.
- Live `https://preeminentstore.com/feed.xml`: **297 items, 0 custom-deck mentions**. Official sealed Commander/Armory decks remain (authentic product).
- Feed filter hardened further (still excludes `deck` / Custom Deck type / unofficial|premade|replica-style titles). Business name / website / business info **not** changed.
- Waiting only on Google’s counterfeit review decision.

## Attempted extra appeal — Oct 20 AM (owner asked to “repeal and let them know”)

- Clicked **Fix issue** on Diagnostics / Overview: Google does **not** open a new review form while the Oct 16 review is pending.
- Merchant Center **Advisor chat** (human-looking but AI): stated we cannot add more text to a pending review; review can take **up to 7 business days**; reinstatement only via that official review.
- **Contact us** form at support.google.com/merchants/gethelp requires a **Google Ads Customer ID** dropdown — Merchant ID `5871019770` alone does not unlock Next (no linked Ads CID selected). Do not force a second overlapping appeal.
- Statement saved for the next available **I disagree / I fixed the issue → Request review** after this review finishes (see Appeal notes above).

## Oct 25–26, 2026 — first review rejected; stronger fix + new review

- Email: **“The requested review of your Merchant Center Account has been completed”** — still **Suspended account due to policy violation (counterfeit product)**. Diagnostics: *During the review you requested on Oct 16, 2026, Google found this still to be an issue.*
- Likely reason the first appeal failed: custom decks were off the feed but still fully crawlable (sitemap + Product JSON-LD on `/p/{id}`), so a manual check could still treat them as promoted non-genuine brand-mimicking products.

### Additional hardening (deployed Oct 26, 2026)

- Shared `isCustomDeckItem` / `allowInMerchantFeed` in `cloudflare/lib/catalog.js`.
- **Sitemap** omits all custom-deck product URLs.
- **Custom-deck product pages**: `noindex, nofollow`; no Product structured data / product price meta (pages stay shoppable for direct visitors).
- Homepage meta description no longer mentions custom-built decks (on-site Custom Decks section unchanged for shoppers).
- Live verified: feed **296 items / 0 decks**; sitemap **0 `deck-` URLs**; sample deck page has **noindex** and **no Product LD**.
- Merchant Center **Update products now** triggered; **new review requested Oct 26, 2026** (“Review requested on Oct 26, 2026. It can take a few days to complete.”).

## What the owner may still need to do

1. Wait for Google’s Oct 26 review result (often a few days; counterfeit can take longer).
2. If Google asks for **identity verification or invoices**, complete that yourself — agents must not handle government ID or EIN.
3. Do **not** change the business name, website, or business info while the review is pending.
4. Do **not** put custom decks back into `feed.xml`, the sitemap, or Product JSON-LD.

## Not related

- Thank-you letters with preeminentstore.com / YouTube — owner chose to keep website promo; that is a marketplace-policy risk for TCGplayer/eBay packages, **not** the cause of this Google Counterfeit email.
- TCGplayer / eBay — no suspension emails found in the last 3 weeks.
- GSC “Page with redirect” validation failures — separate, lower priority than Merchant Center Counterfeit.
