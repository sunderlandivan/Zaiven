# Limited items rule

Prepared Oct 9, 2026.

## Owner decisions (Oct 9, 2026, 4:27 PM)

- **Changed Oct 15, 2026 (owner):** the +$100 is now a *suggestion*, not automatic. Each paid website sale of a listed item adds a pending raise to Portal → Marketing → "Raise after sale"; the price changes only when the owner approves it. The show-1-at-a-time cap is unchanged.

- **Approved and ON** since 2026-10-09 23:33 UTC (4:33 PM Pacific): all 17 items in the confirm list below. The "maybe" items are **not** included.
- `maxShown` = 1, `raiseAfterSale` = $100.
- **Website sales only.** TCGplayer and eBay sales don't trigger a raise.
- No prices were changed when the rule was turned on. Raises happen only after future paid website sales.
- Floors for raises use the item's **highest** unit cost (pricing rule), not the average.

## How the rule works

- **Shows 1 at a time.** The website shows at most 1 unit of each listed item (`maxShown`). The real count stays in the Sheet and in the PC's private stock file. After a sale, the next unit appears on the next publish cycle (about 5 minutes), so the item never shows as sold out until the last real unit is gone.
- **+$100 after each sale.** After each **paid** website order with a listed item, that item's website price goes up by $100 (`raiseAfterSale`), starting from the current site price. Example: $999.99 → $1,099.99 → $1,199.99.
  - It only goes up. If you already have a higher override, the raise starts from that.
  - It never goes below the profit floor (highest unit cost among the item's rows + 15% fees + 10% profit), nor below the site's own floor.
  - One raise per item per order, even if the order is processed again (tracked in `data/limited-items-history.json`). If an order has 2 of the same item, that's still one raise.
  - Zelle/Venmo orders raise only once you mark them paid. Cancelled, expired and test orders never raise.
  - Only sales **after** you turn the rule on count. Older orders are ignored.
  - Only the host holding the portal lease (normally this PC) applies raises.
  - You get a desktop notification each time: "Raised X from $A to $B after a sale".
- **Turning it on/off:** Portal → Marketing → "Limited items". Only works from the portal on this PC. Turning it off stops the cap and future raises. Raised prices stay where they are until you change them.

## Answers (Oct 9, 2026)

1. **Which items?** All 17 in the confirm list. No "maybe" items.
2. **TCGplayer / eBay sales:** website sales only.
3. **Units shown:** 1.
4. **When to turn it on:** turned on Oct 9, 2026.

## Columns

- **Site price** = the price on preeminentstore.com today. **Floor** = the lowest price the site allows (profit floor). Every raise goes up from the site price, so profit only grows.
- **In stock** = real units (private, never shown on the site). **TCG market** = from `docs/price-proposal-2026-10-09.md` (pulled Oct 9).
- Items already at 1 unit won't change on screen; for those the rule only adds the +$100 raise.

## Approved list (owner OK, Oct 9, 2026)

### Magic Collector Booster Displays (9)

| ✓ | Item | Catalog id | Site price | In stock | TCG market | Floor | Why |
|---|---|---|---:|---:|---:|---:|---|
| [x] | FINAL FANTASY - Collector Booster Display | 618893 | $2,499.99 | 4 | $1,666.85 | $564.89 | Collector display; 1.5× market |
| [x] | The Hobbit - Collector Booster Display | 692963 | $1,999.99 | 4 | $711.10 | $598.53 | Collector display; 2.8× market |
| [x] | Secrets of Strixhaven - Collector Booster Display | 675558 | $1,099.99 | 7 | $499.94 | $519.58 | Collector display; 2.2× market |
| [x] | Marvel's Spider-Man - Collector Booster Display | 621110 | $999.99 | 3 | $413.70 | $705.62 | Collector display; 2.4× market |
| [x] | Lorwyn Eclipsed - Collector Booster Display | 656322 | $999.99 | 2 | $416.79 | $529.94 | Collector display; 2.4× market |
| [x] | Marvel Super Heroes - Collector Booster Display | 675606 | $999.99 | 3 | $457.59 | $616.65 | Collector display; 2.2× market |
| [x] | Avatar: The Last Airbender - Collector Booster Display | 648650 | $666.99 | 3 | $478.71 | $637.87 | Collector display |
| [x] | Tarkir: Dragonstorm - Collector Booster Display | 619649 | $599.99 | 11 | $496.76 | $390.18 | Collector display |
| [x] | Reality Fracture - Collector Booster Display | 692983 | $599.99 | 10 | $440.12 | $422.74 | Collector display |

### Pokemon Center Elite Trainer Boxes (3)

| ✓ | Item | Catalog id | Site price | In stock | TCG market | Floor | Why |
|---|---|---|---:|---:|---:|---:|---|
| [x] | 30th Celebration Pokemon Center Elite Trainer Box | 704144 | $999.99 | 2 | $286.24 | $79.58 | Pokemon Center exclusive + 30th Celebration; 3.5× market |
| [x] | Phantasmal Flames Pokemon Center Elite Trainer Box (Exclusive) | 654135 | $499.99 | 1 | $286.30 | $86.05 | Pokemon Center exclusive; 1.7× market |
| [x] | Perfect Order Pokemon Center Elite Trainer Box | 672404 | $399.99 | 6 | $123.81 | $79.59 | Pokemon Center exclusive; 3.2× market |

### Other limited / premium sealed (5)

| ✓ | Item | Catalog id | Site price | In stock | TCG market | Floor | Why |
|---|---|---|---:|---:|---:|---:|---|
| [x] | Fujimi Fantasia Bunko Vol. 2 Booster Box Case | 666900 | $3,999.99 | 6 | $1,469.62 | $2,425.82 | Japanese case, limited print; 2.7× market |
| [x] | Azur Lane Vol. 2 Booster Box Case | 646343 | $1,999.99 | 1 | $1,382.05 | $1,437.96 | Limited case; 1.4× market |
| [x] | Riftbound: League of Legends Arcane Box Set | 655495 | $999.99 | 2 | $529.52 | $105.46 | Special edition box set; 1.9× market |
| [x] | Mega Charizard X ex Ultra Premium Collection | 654213 | $499.99 | 10 | $220.43 | $170.18 | Ultra-Premium Collection; 2.3× market |
| [x] | Flesh and Blood Mistveil Archive Booster Box (Japanese Exclusive) | flesh-and-blood-tcg-part-the-mistveil-archive-booster-box-japanese-exclusive-fab | $99.99 | 2 | — | $92.53 | Japanese exclusive; no TCGplayer market |

## Maybe (not included, owner declined Oct 9, 2026)

Hyped or priced well above market, but not clearly "limited". With +$100 per sale, cheaper items here would jump a lot in relative terms (e.g. $99.99 → $199.99).

| ✓ | Item | Catalog id | Site price | In stock | TCG market | Floor | Why maybe |
|---|---|---|---:|---:|---:|---:|---|
| [ ] | Chaos Rising Booster Box | 684444 | $599.99 | 2 | $184.46 | $339.71 | 3.3× market; regular booster box |
| [ ] | Delta Reign Booster Box | 712094 | $499.99 | 1 | $250.14 | $227.34 | 2.0× market; regular booster box |
| [ ] | FINAL FANTASY - Chocobo Bundle | 656616 | $399.99 | 3 | $298.13 | $205.11 | Special bundle; 1.3× market |
| [ ] | 30th Celebration Elite Trainer Box | 704143 | $183.99 | 2 | $139.23 | $183.12 | 30th Celebration, but the standard ETB |
| [ ] | Ascended Heroes Booster Bundle | 668541 | $124.99 | 4 | $82.33 | $39.51 | Hyped set; 1.5× market |
| [ ] | FINAL FANTASY Commander Deck - FINAL FANTASY VI Revival Trance | 618903 | $109.99 | 8 | $33.34 | $99.53 | 3.3× market; not limited |
| [ ] | Prismatic Evolutions Booster Bundle | 600518 | $99.99 | 1 | $86.55 | $40.05 | Hyped set |
| [ ] | 30th Celebration Booster Bundle | 704171 | $84.99 | 3 | $72.13 | $36.81 | 30th Celebration |
| [ ] | FINAL FANTASY - Starter Kit | 618901 | $35.99 | 4 | $12.60 | $29.66 | 2.9× market; not limited, +$100 would triple it |

## Files

- Rule: `server/limitedItems.js` (cap, raises, owner toggle, portal API). Tests: `server/limitedItems.test.js` (`npm run test:limited`).
- Hooks: `server/storePublish.js` (cap on pushed stock; raises in the publish cycle and after "Mark paid"), `server/storeCatalog.js` ("Low stock" flag uses the shown count).
- Settings: `limitedItems` in `data/store-settings.json` (`enabled: false`, `maxShown: 1`, `raiseAfterSale: 100`, `itemIds: []`).
- Raise history: `data/limited-items-history.json` (created on the first raise).
- Portal: Marketing page → "Limited items".
