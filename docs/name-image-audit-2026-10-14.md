# Website name vs. image audit — 2026-10-14

Read-only audit. Nothing was changed on the Sheet, catalog, site, feed, or prices. The owner decides the fixes.

**Why it matters:** a Google Merchant Center Misrepresentation review is pending, and a title that doesn't match its photo is exactly the kind of thing a reviewer flags.

## How it was checked

- **Sealed listings (103):** read the current in-stock rows from Inventory26 and Inventory25 (Qty > 0, Last Retail > 0) and grouped them exactly the way `server/storeCatalog.js` does (rows sharing a TCGplayer id become one listing). Each linked id was looked up on TCGplayer (`mp-search-api.tcgplayer.com/v2/product/<id>/details`). Every row name was then compared with the TCGplayer listing title `Product - Set (CODE)`, which is the Sheet naming convention and the product the image comes from.
- **Singles (200):** each card's image product id (`data/tcgplayer-single-ids.json`) was looked up on TCGplayer. The returned card name and set were compared with the listed name and set, and the image file was confirmed to exist.
- **Custom decks (37):** deck names were compared with their eBay titles, all photo files were confirmed present, and the photos were hashed to check that no two decks share one.
- **Live site:** `https://preeminentstore.com/catalog.json` (340 items) and `https://preeminentstore.com/feed.xml` (333 items) were compared with the local catalog. Live and local match, with the same titles and the same image-less items.
- **Also checked:** every Sheet row with a TCGplayer link, including Qty 0 rows (not live today but would go live on restock), and every row without a link.

## Summary

| | Count |
|---|---|
| Listings checked | 340 (103 sealed, 200 singles, 37 custom decks) |
| Live title ≠ image (real mismatch) | **1** (`/p/609716`, in the Google feed) |
| Listings merging different products | **1** (the same `/p/609716`) |
| Sealed rows whose name exactly equals the TCGplayer title | 107 of 109 in-stock rows |
| Singles with wrong image | 0 |
| Custom decks with wrong or missing photo | 0 |
| Listings with no image (store shows no photo; **not** in the feed) | 7 |
| Latent mislinked rows (Qty 0 today, not live) | 4 |

## Real mismatches (live)

| Listing | Site title | TCGplayer product (the image) | Sheet rows merged | Site price / qty | In Google feed? | Likely fix |
|---|---|---|---|---|---|---|
| [/p/609716](https://preeminentstore.com/p/609716) | 2 Pk Pokemon Surging Twilight with Token | Prismatic Evolutions 2-Pack Blister [Eevee] — SV: Prismatic Evolutions | Inventory25 row 74 "2 Pk Pokemon Surging Twilight with Token" (3 @ $9.99); Inventory25 row 78 "Pokemon Aloha First Starters" (2 @ $14.25) | $29.99 / 5 | **Yes** (title "2 Pk Pokemon Surging Twilight with Token" + Eevee image) | **Unlink both rows** from 609716, unless the physical items really are Prismatic Evolutions Eevee 2-pack blisters (then rename both rows to the TCGplayer title). The two rows are clearly different products and shouldn't share a listing. No TCGplayer product is named "Surging Twilight" or "Aloha First Starters" (searched, including Surging Sparks / Twilight Masquerade blisters and First Partner packs), so the owner needs to check the packaging. Once identified, relink each row to its own TCGplayer id, or leave it unlinked (it then lists without a photo and drops out of the feed until it has one). |

**Merge impact on 609716:**
- **Stock is inflated as one product:** the site sells 5 units of "Surging Twilight", but only 3 are that item. The other 2 are a different product ("Aloha First Starters").
- **Cost basis is wrong:** the highest-cost rule takes $14.25 (the Aloha row) for the whole listing, so the floor ($17.95) is too high for the $9.99 Surging Twilight units. It also hides the Aloha item's own pricing.
- **Price comparison is wrong:** the catalog price logic compares against the Prismatic Evolutions Eevee blister on TCGplayer, which is a different product.
- **Prior audit:** `docs/price-proposal-2026-10-09.md` / `data/price-proposal-2026-10-09-inv25.csv` priced this listing as one item ("Inv25 r74: 3@9.99; Inv25 r78: 2@14.25"). That proposal line should be redone per real product once the rows are fixed.

**Quickest Merchant-safe option (owner's call):** remove the TCGplayer link from rows 74 and 78. The listing then has no image and leaves `feed.xml` automatically (the feed already skips image-less items). Re-add each row with a correct link or a real photo later.

## Merged-row check (all other merges are fine)

These listings merge more than one row, and every row in each one has the identical, correct name. They are legitimate restocks of the same product. Because cost basis uses the highest cost, the older/pricier lot sets the floor:

| Listing | Rows | Costs (highest drives floor) |
|---|---|---|
| 610953 Journey Together Booster Bundle | Inv26 r11 (5), Inv26 r27 (5) | $37.68 / $37.68 |
| 618890 FINAL FANTASY Play Booster Display | Inv26 r17 (1), Inv25 r87 (18) | $119 / **$167** |
| 621107 Marvel's Spider-Man Play Booster Display | Inv26 r20 (3), Inv25 r100 (15) | $119 / **$232.20** |
| 635368 Riftbound Origins Booster Display | Inv26 r36 (12), Inv25 r109 (3) | **$299** / $250 |
| 666900 Fujimi Fantasia Bunko Vol. 2 Booster Box Case | Inv26 r39 (3), Inv26 r49 (3) | **$1,874.99** / $1,871 |

## Listings with no image (not in the Google feed)

These are on the website without a product photo. They are **not** in `feed.xml` (333 = 340 − these 7), so they don't affect the Merchant review, but they look bare on the site.

| Listing | Why no image | Suggestion |
|---|---|---|
| 685924 Costco 6-Pack Poke balls | Linked correctly, but TCGplayer has no image for this product (image URL returns 404) | Add an own photo |
| Flesh and Blood TCG Part The Mistveil Archive Booster Box Japanese Exclusive FaB (Inv26 r7, 2 @ $70) | Linked to an eBay listing, not TCGplayer | Keep unlinked. TCGplayer's "Part the Mistveil Booster Box" (543923) is the **English** product, so linking it would create a language mismatch. Add an own photo. |
| ZLCA DeckBox Prem Magnetic (Inv25 r118) | No link (accessory) | Own photo |
| ZLCA DeckBox (Inv25 r119) | No link | Own photo |
| Clear Deckbox w/ Color Sleeves (Inv25 r120) | No link | Own photo |
| Art Sleeves (Inv25 r121) | No link | Own photo |
| Clear Sleeves (Inv25 r122) | No link | Own photo |

## Latent mislinked rows (Qty 0 today — not live, but will mislist on restock)

| Row | Name | Linked to (TCGplayer) | Suggested fix |
|---|---|---|---|
| Inventory25 row 105 | Wilds of Eldraine Play | 619645 Tarkir: Dragonstorm - Play Booster Display | Relink to the Wilds of Eldraine Play/Draft display (look up the exact product) or clear the link. If this row ever gets Qty > 0, it merges into the live Tarkir Play listing and its $144.66 cost becomes that listing's cost basis. |
| Inventory25 row 123 | Godzilla Mat XL | 619649 Tarkir: Dragonstorm - Collector Booster Display | Clear the link (accessory, no TCGplayer product) |
| Inventory25 row 14 | White Flare Poster | 630612 Unova Poster Collection — SV: **Black Bolt** | If it's really the White Flare version, relink. TCGplayer search found no stand-alone White Flare poster collection (closest: 685927 "White Flare Binder & Unova Poster Collection (Sam's Club)"). If it's the standard Unova Poster Collection, rename the row to match. |
| Inventory25 row 35 | Meddling Sparks | 593466 Prismatic Evolutions Surprise Box | Relink to 606605 "Meddling Sparks Premium Collection" (Miscellaneous Cards & Products) |

Rows without any link and Qty 0 (Tyranitar/Tsareena ex Prem. Coll. Box, Magic Spiderman Play Pak, Gundam NewType Booster Box, four Gundam Assemble Starters) would list without a photo if restocked.

## Probably OK — wording only

No live sealed listing has a wording-only difference: all 107 other in-stock rows use the exact TCGplayer title. All 200 singles take their title from the TCGplayer seller export and their image id resolves to the same card name and set. All 37 custom decks use a cleaned-up version of their own eBay title (e.g. "Pokemon Standard Gengar Premade TCG Deck! …" → "Pokémon Gengar Premade Deck") with their own eBay photos, so they're fine.

Minor, eBay-side only: the eBay descriptions for the Gengar (267799137790) and Shaymin Green (267466152297) decks describe a "Steel Dark … Tyranitar" deck (copy-paste). The website doesn't use eBay descriptions, so the site and feed aren't affected, but the eBay listings may be worth fixing.
