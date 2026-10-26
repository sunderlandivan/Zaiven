# Price proposal: matching TCGplayer market on the website

Prepared Oct 9, 2026. **Proposal only. Nothing has been changed:** no website price, override, TCGplayer, eBay or Sheet value was touched. Per the pricing rule, none of this is applied until you OK specific items.

## Owner decisions (Oct 9, 2026)

- **All 12 EASY items: keep current price.** Owner reviewed each one and declined every proposal. Don't re-propose these without a new reason (e.g. stock aging, market moved up).
- **Limited items rule: approved and ON (Oct 9, 2026, 4:27 PM).** 17 items (collector displays, Pokemon Center ETBs, other limited items): current prices kept, website shows 1 unit at a time, +$100 after each paid website sale (website sales only). See `docs/limited-items-rule.md`.
- **Inventory25-costed EASY (20): all kept at current price.** 14 reviewed (Battle Styles, Chocobo Bundle, Stellar Crown, Ikoria, Avatar Commander's Bundle one by one; FF Bundle, NIKKE, Duskmourn PBD, Journey Together ETB, Prismatic Bundle, Morpeko, Scarlet & Violet box, Edge of Eternities Commander, 151 pack shown with my price / TCG market / proposed) and declined. The other 6 are on the limited-items rule (show 1, +$100 per website sale), enabled Oct 9.
- Owner preference: when proposing prices, always show **my price, TCGplayer market, TCGplayer lowest delivered, and proposed** side by side.
- **Accessories (deck boxes, sleeves, etc.): always use the owner's price.** Don't propose market-matching for accessories. Applies to ZLCA DeckBox Prem Magnetic, ZLCA DeckBox, Clear Deckbox w/ Color Sleeves, Art Sleeves, Clear Sleeves (all profitable at current price).
- **FaB Mistveil Archive Japanese Exclusive box: keep $99.99.**
- **CLOSE (22: 13 original + 9 Inventory25): all kept at current price**, reviewed one at a time with a ~20% profit middle option offered for each; owner declined every change.
- CAN'T (35) and already-competitive (8): no decision needed; current prices stay.
- **Audit complete (Oct 9, 2026): no prices changed.** Every in-stock item is profitable at its current price using the highest-cost baseline and worst-case PayPal fee (incl. CA tax).
- Owner approved a one-time, read-only Inventory25 cost lookup on Oct 9, 2026 (values only; no writes; Sold 2025 not read). Results in "Cost-unknown items, costed from Inventory25" below.
- **Owner rule (Oct 9, 2026): cost baseline = the highest unit cost** among all of an item's rows (Inventory26 + Inventory25), never an average. Every number below was recomputed that way.
- ~~Website price floor = highest cost, 10% fee assumption, 10% profit (~5:07 PM).~~ Superseded by the two decisions below (~5:09 PM); never switched on.
- **Owner-reviewed prices are LOCKED (Oct 9, 2026, ~5:09 PM).** Every in-stock item reviewed today (EASY, CLOSE, CAN'T, already-competitive, no-market, accessories, and the 17 limited items) keeps its current website price. That's all 103 sealed items, stored in `lockedPrices` in `data/store-settings.json` (`lockedPricesReviewedOn: "2026-10-09"`). The website always charges the locked price: no floor, clamp or automation moves it up or down. For locked items the floor is only a check. If a locked price is ever below its floor, it's logged as `locked_below_floor` in the price review and a server warning, and the price is kept. The only allowed automatic change is the limited-items rule's +$100 after each paid website sale, which updates the locked price too. Anything else needs your explicit OK. (The 30th Celebration ETB stays $183.99.)
- **Site price floor = explicit fee, tax and shipping math on the highest cost (Oct 9, 2026, ~5:09 PM)** (`floorModel: "explicit"`). The floor is the lowest price P where **P − PayPal fee − net shipping − highest unit cost ≥ minimum profit × highest unit cost**:
  - **PayPal fee** = 3.49% × (P + $10.99 shipping charged + P × 8.75% worst-case CA tax) + $0.49. Shipping isn't taxed. Tax is pass-through, never income.
  - **Net shipping** = label estimate − $10.99 shipping charged, only if positive. Label estimates: small $6.11, ETB/collection/deck case $9.47, box/display $9.96, booster box case $23.05.
  - **Minimum profit on cost:** **15% for existing items**; **10% for new items** (first seen in the catalog after Oct 9, 2026; tracked per catalog id in `data/store-first-seen.json`).
  - Applies to items without a locked price (new items). It replaces the old blanket 15% fee on the average cost; the 15% `pricing.feeRate` setting is kept only for the old formula and is no longer used.
  - Switched on Oct 9 after a dry run: all 304 live prices unchanged, no locked price below its floor.

## Summary

All costs use the **highest unit cost** per item, and every PayPal fee includes worst-case CA sales tax (see Assumptions).

**No item's current website price is at a loss or below the 10% rule** (all 103 items with a cost, at the highest cost).

| List | Original 58 items | 45 Inventory25-costed items |
|---|---:|---:|
| EASY | 12 | 20 |
| CLOSE | 13 | 9 |
| CAN'T | 26 | 9 |
| Already competitive | 6 | 2 |
| No market | 1 | 5 |
| Missing cost | 0 | 0 |

### What changed with the highest-cost rule

| Item | Section | Old cost | Highest cost | Old list | New list | Why |
|---|---|---:|---:|---|---|---|
| FINAL FANTASY - Play Booster Display | original | $119.00 | $167.00 | EASY | EASY | cost up, list unchanged |
| Journey Together Booster Bundle | original | $37.68 | $37.68 | CLOSE | CAN'T | PayPal fee on sales tax |
| Fujimi Fantasia Bunko Vol. 2 Booster Box Case | original | $1,873.00 | $1,874.99 | CAN'T | CAN'T | cost up, list unchanged |
| Marvel's Spider-Man - Play Booster Display | original | $119.00 | $232.20 | CAN'T | CAN'T | cost up, list unchanged |
| 2 Pk Pokemon Surging Twilight with Token | Inventory25 | $11.69 | $14.25 | Already competitive | Already competitive | cost up, list unchanged |

**If you approved all 12 EASY items** in list (a), the website would drop by $3,465.00 in list price. The lowest EASY margin is 18%. (You kept all 12 EASY items at current price on Oct 9; this list is for reference.)

### ⚠ One thing to decide before applying anything

The website already has its own price floor (`pricing` in `data/store-settings.json`: `feeRate 0.15`, `minProfitPct 0.10`). It assumes **15% fees on every sale**, like TCGplayer, and a price override **can never go below that floor**: the catalog uses whichever is higher. Items marked **†** have a proposed price under that 15% floor (computed here at the highest cost), so an override alone would be silently raised back up to it.

- †-marked items: EASY 3, CLOSE 22. Every CAN'T floor is also †.
- A website sale really costs 3.49% + $0.49 (PayPal), so the 15% floor is very conservative for the site.
- To apply † prices, you'd also need to OK lowering `pricing.feeRate`. That's a pricing change too, so it's your call.
- Note: the site's own floor in `server/storeCatalog.js` still uses the quantity-weighted **average** cost across rows, not the highest. Not changed (code change needs your OK).

**◆** = the item's in-stock rows have different unit costs; the highest is used.

## Assumptions

- **Cost: the highest unit cost** ("Cost w/ Tax", a per-unit column: Total Inv $ = Qty × Cost) among the item's rows in Inventory26 and Inventory25, read-only. Rows are matched like the catalog: the TCGplayer product id in the row's link, or the exact Item ID. A sold-out row for a *different* product that only shares the link is ignored.
- **Payment fee (worst case = PayPal):** 3.49% + $0.49 on **item price + the $10.99 shipping + CA sales tax at the highest configured rate (8.75%: base + every district in `salesTax`)**. Shipping isn't taxed (`taxShipping: false`). The tax is passed through to CDTFA and never counted as income. Zelle is $0 and Venmo is 1.9% + $0.10; out-of-state and non-district orders pay less fee.
- **Shipping:** buyers pay a flat **$10.99 per sealed order**. Label estimates (median of your single-item USPS labels): small (bundle/blister/pack) **$6.11**, ETB / collection / deck case **$9.47**, booster box / display **$9.96**, case **$23.05**. **Net shipping = label − $10.99, never below $0** (only cases cost more, about $12 net).
- **Profit rule:** profit ≥ **10% of cost**. "Margin" is **profit ÷ cost**.
- **Formulas:** fee = 0.0349 × (price × 1.0875 + 10.99) + 0.49. Profit = price − fee − net shipping − cost. Break-even = (cost + net ship + 0.49 + 0.0349 × 10.99) ÷ (1 − 0.0349 × 1.0875). Lowest safe price = same with 1.10 × cost, rounded up to .99.
- **Lists:** Already competitive = current price at/under market, or the 2%-under price would cut less than 3%. EASY = 2% under market (ending .99, never above market) with profit ≥ 15%. CLOSE = 2% under market at 10–15% profit, or the safe floor within 10% of market. CAN'T = safe floor more than 10% above market.
- **Data sources:** site prices from `data/store-stock.json`; TCGplayer market and lowest listing from TCGplayer's public product data (`server/tcgplayerCatalog.js`), pulled Oct 9, 2026. Sold 2025 wasn't used.
- Single-item orders. A multi-item order pays $10.99 once, so the per-item fee is slightly lower than shown.

## (a) EASY: match market and stay profitable (12)

Ranked by the dollar drop from the current site price.

| Item | Cost (max) | Current site | TCG market | TCG lowest (delivered) | Proposed | Drop | PayPal fee | Ship est. (label / net) | Profit | Margin (of cost) | Break-even | Profit at current |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| The Hobbit - Collector Booster Display | $461.00 | $1,999.99 | $711.10 | $693.51 | **$696.99** | −65% | $27.33 | $9.96 / $0.00 | $208.66 | 45% | $480.09 | $1,462.21 (317%) |
| 30th Celebration Pokemon Center Elite Trainer Box | $59.99 | $999.99 | $286.24 | $286.98 | **$280.99** | −72% | $11.54 | $9.47 / $0.00 | $209.46 | 349% | $63.26 | $901.17 (1502%) |
| Secrets of Strixhaven - Collector Booster Display † | $399.99 | $1,099.99 | $499.94 | $499.75 | **$489.99** | −55% | $19.47 | $9.96 / $0.00 | $70.53 | 18% | $416.68 | $657.38 (164%) |
| Perfect Order Pokemon Center Elite Trainer Box | $60.00 | $399.99 | $123.81 | $124.97 | **$121.99** | −69% | $5.50 | $9.47 / $0.00 | $56.49 | 94% | $63.28 | $323.94 (540%) |
| Delta Reign Booster Box | $174.17 | $499.99 | $250.14 | $249.85 | **$245.99** | −51% | $10.21 | $9.96 / $0.00 | $61.61 | 35% | $181.95 | $305.97 (176%) |
| Reality Fracture - Collector Booster Display | $325.16 | $599.99 | $440.12 | $436.00 | **$431.99** | −28% | $17.27 | $9.96 / $0.00 | $89.56 | 28% | $338.90 | $251.18 (77%) |
| Ascended Heroes Booster Bundle | $29.03 | $124.99 | $82.33 | $82.99 | **$80.99** | −35% | $3.95 | $6.11 / $0.00 | $48.01 | 165% | $31.08 | $90.34 (311%) |
| Tarkir: Dragonstorm - Play Booster Display | $100.00 | $189.99 | $166.21 | $166.93 | **$162.99** | −14% | $7.06 | $9.96 / $0.00 | $55.93 | 56% | $104.85 | $81.91 (82%) |
| Delta Reign Booster Bundle | $29.03 | $99.99 | $77.04 | $75.13 | **$75.99** | −24% | $3.76 | $6.11 / $0.00 | $43.20 | 149% | $31.08 | $66.29 (228%) |
| Magic: The Gathering Foundations - Play Booster Display | $129.00 | $189.99 | $176.76 | $179.99 | **$173.99** | −8% | $7.48 | $9.96 / $0.00 | $37.51 | 29% | $135.00 | $52.91 (41%) |
| 30th Celebration Booster Bundle | $26.94 | $84.99 | $72.13 | $72.85 | **$70.99** | −16% | $3.57 | $6.11 / $0.00 | $40.48 | 150% | $28.91 | $53.95 (200%) |
| FINAL FANTASY - Play Booster Display ◆ | $167.00 | $259.99 | $257.04 | $257.75 | **$251.99** | −3% | $10.44 | $9.96 / $0.00 | $74.55 | 45% | $174.50 | $82.25 (49%) |

## (b) CLOSE: within about 10% of market at a safe profit (13)

"Proposed" is about 2% under market if that still clears 10% profit, otherwise the lowest safe price at 10% profit.

| Item | Cost (max) | Current site | TCG market | TCG lowest (delivered) | Proposed | Drop | PayPal fee | Ship est. (label / net) | Profit | Margin (of cost) | vs market | Break-even | Profit at current |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| The Hobbit Scene Box - Treasures of Smaug † | $55.00 | $150.99 | $63.22 | $56.95 | **$63.99** | −58% | $3.30 | $9.47 / $0.00 | $5.69 | 10% | +1% | $58.08 | $89.39 (163%) |
| Two Legends - Booster Box † | $205.00 | $279.99 | $246.75 | $240.00 | **$241.99** | −14% | $10.06 | $9.96 / $0.00 | $26.93 | 13% | at/under | $214.00 | $63.49 (31%) |
| Charizard ex Special Collection † | $53.55 | $99.99 | $58.42 | $47.44 | **$62.99** | −37% | $3.26 | $9.47 / $0.00 | $6.18 | 12% | +8% | $56.57 | $41.77 (78%) |
| Adventure on Kami's Island Booster Box † | $230.00 | $299.99 | $256.66 | $256.94 | **$263.99** | −12% | $10.89 | $9.96 / $0.00 | $23.10 | 10% | +3% | $239.98 | $57.73 (25%) |
| Avatar: The Last Airbender - Play Booster Display † | $119.00 | $169.99 | $132.87 | $131.40 | **$136.99** | −19% | $6.07 | $9.96 / $0.00 | $11.92 | 10% | +3% | $124.60 | $43.66 (37%) |
| Perfect Order Booster Bundle † | $34.00 | $69.99 | $38.08 | $40.99 | **$39.99** | −43% | $2.39 | $6.11 / $0.00 | $3.60 | 11% | +5% | $36.25 | $32.46 (95%) |
| Secrets of Strixhaven - Play Booster Display † | $135.00 | $184.99 | $142.08 | $141.49 | **$155.99** | −16% | $6.79 | $9.96 / $0.00 | $14.20 | 11% | +10% | $141.23 | $42.10 (31%) |
| Perfect Order Elite Trainer Box † | $64.64 | $99.99 | $71.45 | $74.99 | **$74.99** | −25% | $3.72 | $9.47 / $0.00 | $6.63 | 10% | +5% | $68.10 | $30.68 (47%) |
| Pitch Black Elite Trainer Box † | $64.65 | $99.99 | $71.16 | $60.00 | **$74.99** | −25% | $3.72 | $9.47 / $0.00 | $6.62 | 10% | +5% | $68.11 | $30.67 (47%) |
| Usurp the Shadow Throne Booster Box † | $87.25 | $119.99 | $100.67 | $99.94 | **$100.99** | −16% | $4.71 | $9.96 / $0.00 | $9.03 | 10% | +0% | $91.60 | $27.31 (31%) |
| Crucible of War Booster Box [Unlimited Edition] † | $45.00 | $62.99 | $49.87 | $44.50 | **$52.99** | −16% | $2.88 | $9.96 / $0.00 | $5.11 | 11% | +6% | $47.68 | $14.73 (33%) |
| Perfect Order 3 Pack Blister [Chikorita] † | $17.20 | $29.99 | $19.55 | $18.46 | **$20.99** | −30% | $1.67 | $6.11 / $0.00 | $2.12 | 12% | +7% | $18.79 | $10.78 (63%) |
| Pitch Black 3-Pack Blister [Binacle] † | $17.20 | $29.99 | $19.58 | $21.95 | **$20.99** | −30% | $1.67 | $6.11 / $0.00 | $2.12 | 12% | +7% | $18.79 | $10.78 (63%) |

## (c) CAN'T: market is below the safe floor (26)

Matching market would lose money or break the 10% rule. Options: keep the current price, or drop to the lowest safe price. Fee and profit columns are at the safe floor.

| Item | Cost (max) | Current site | TCG market | Lowest safe price | Floor vs market | PayPal fee | Ship est. | Profit at floor | Margin | Break-even | Profit at current |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Marvel Super Heroes - Play Booster Display † | $220.00 | $299.99 | $111.37 | $252.99 | +127% | $10.48 | $9.96 | $22.51 | 10% | $229.59 | $67.73 (31%) |
| Marvel's Spider-Man - Play Booster Display † ◆ | $232.20 | $299.99 | $120.25 | $266.99 | +122% | $11.01 | $9.96 | $23.78 | 10% | $242.27 | $55.53 (24%) |
| The Hobbit Scene Box - Crack the Plates † | $85.00 | $150.99 | $48.87 | $98.99 | +103% | $4.63 | $9.47 | $9.36 | 11% | $89.26 | $59.39 (70%) |
| Secrets of Strixhaven - Bundle † | $85.00 | $116.99 | $49.40 | $98.99 | +100% | $4.63 | $9.47 | $9.36 | 11% | $89.26 | $26.68 (31%) |
| Omens of the Third Age Booster Box † | $79.99 | $110.99 | $50.28 | $92.99 | +85% | $4.40 | $9.96 | $8.60 | 11% | $84.05 | $25.91 (32%) |
| Chaos Rising Booster Box † | $261.00 | $599.99 | $184.46 | $299.99 | +63% | $12.26 | $9.96 | $26.73 | 10% | $272.20 | $315.34 (121%) |
| Origins - Booster Display † ◆ | $299.00 | $399.99 | $223.14 | $342.99 | +54% | $13.89 | $9.96 | $30.10 | 10% | $311.70 | $84.94 (28%) |
| The Hobbit - Play Booster Display † | $200.00 | $299.99 | $153.39 | $229.99 | +50% | $9.60 | $9.96 | $20.39 | 10% | $208.80 | $87.73 (44%) |
| Compendium of Rathe Booster Box † | $105.93 | $145.99 | $82.75 | $122.99 | +49% | $5.54 | $9.96 | $11.52 | 11% | $111.02 | $33.65 (32%) |
| Fujimi Fantasia Bunko Vol. 2 Booster Box Case † ◆ | $1,874.99 | $3,999.99 | $1,469.62 | $2,157.99 | +47% | $82.78 | $23.05 | $188.16 | 10% | $1,962.40 | $1,960.25 (105%) |
| Steel Requiem Booster Box † | $190.00 | $259.99 | $155.16 | $218.99 | +41% | $9.19 | $9.96 | $19.80 | 10% | $198.40 | $59.25 (31%) |
| Lumiose City Mini Tin Display † | $139.75 | $199.99 | $114.91 | $160.99 | +40% | $6.98 | $9.96 | $14.26 | 10% | $146.17 | $51.78 (37%) |
| Tales of Aria Booster Box [Unlimited Edition] † | $45.00 | $62.99 | $39.20 | $52.99 | +35% | $2.88 | $9.96 | $5.11 | 11% | $47.68 | $14.73 (33%) |
| Welcome to Rathe Booster Box [Unlimited Edition] † | $60.00 | $83.99 | $55.38 | $69.99 | +26% | $3.53 | $9.96 | $6.46 | 11% | $63.28 | $19.93 (33%) |
| Avatar: The Last Airbender - Jumpstart Booster Display † | $99.00 | $139.99 | $91.59 | $114.99 | +26% | $5.24 | $9.96 | $10.75 | 11% | $103.81 | $34.80 (35%) |
| Arcane Rising Booster Box [Unlimited Edition] † | $70.00 | $96.99 | $65.66 | $80.99 | +23% | $3.95 | $9.96 | $7.04 | 10% | $73.67 | $22.44 (32%) |
| Secrets of Strixhaven Commander Deck Case † | $245.00 | $333.99 | $230.90 | $281.99 | +22% | $11.58 | $9.47 | $25.41 | 10% | $255.57 | $75.44 (31%) |
| Lorwyn Eclipsed - Play Booster Display † | $119.00 | $169.99 | $113.92 | $136.99 | +20% | $6.07 | $9.96 | $11.92 | 10% | $124.60 | $43.66 (37%) |
| Obsidian Flames Booster Box † | $384.00 | $529.99 | $366.27 | $439.99 | +20% | $17.57 | $9.96 | $38.42 | 10% | $400.06 | $125.00 (33%) |
| Marvel Super Heroes - Collector Booster Display † | $475.00 | $999.99 | $457.59 | $544.99 | +19% | $21.56 | $9.96 | $48.43 | 10% | $494.65 | $486.16 (102%) |
| Spiritforged - Booster Display † | $190.00 | $259.99 | $184.93 | $218.99 | +18% | $9.19 | $9.96 | $19.80 | 10% | $198.40 | $59.25 (31%) |
| Perfect Order Booster Box † | $175.00 | $299.99 | $171.43 | $201.99 | +18% | $8.54 | $9.96 | $18.45 | 11% | $182.81 | $112.73 (64%) |
| Paradox Rift Booster Box † | $287.00 | $399.99 | $283.10 | $329.99 | +17% | $13.40 | $9.96 | $29.59 | 10% | $299.23 | $96.94 (34%) |
| 30th Celebration Elite Trainer Box † | $140.00 | $183.99 | $139.23 | $160.99 | +16% | $6.98 | $9.47 | $14.01 | 10% | $146.43 | $36.13 (26%) |
| Lorwyn Eclipsed - Collector Booster Display † | $408.00 | $999.99 | $416.79 | $467.99 | +12% | $18.64 | $9.96 | $41.35 | 10% | $425.00 | $553.16 (136%) |
| Journey Together Booster Bundle † | $37.68 | $59.99 | $40.88 | $44.99 | +10% | $2.58 | $6.11 | $4.73 | 13% | $40.07 | $19.16 (51%) |

## Already competitive (6)

| Item | Cost (max) | Current site | TCG market | Break-even | Profit at current | Margin | Note |
|---|---:|---:|---:|---:|---:|---:|---|
| Uprising Booster Box Case | $178.08 | $242.99 | $240.64 | $198.55 | $42.75 | 24% | within 3% of market; optional trim to $235.99 |
| Bloomburrow - Play Booster Display | $118.00 | $199.99 | $202.95 | $123.56 | $73.53 | 62% | already at or below market |
| Edge of Eternities - Play Booster Display | $124.00 | $169.99 | $192.35 | $129.80 | $38.66 | 31% | already at or below market |
| Pokemon Day 2026 Collection | $19.36 | $36.99 | $38.07 | $21.03 | $15.35 | 79% | already at or below market |
| Marvel Super Heroes Commander Deck Case | $70.00 | $185.99 | $184.05 | $73.67 | $108.06 | 154% | within 3% of market; optional trim to $180.99 |
| Costco 6-Pack Poke balls | $78.64 | $121.99 | $121.87 | $82.65 | $37.85 | 48% | within 3% of market; optional trim to $119.99 |

## No TCGplayer market (1)

| Item | Cost (max) | Current site | Break-even | Lowest safe price | Profit at current | Margin |
|---|---:|---:|---:|---:|---:|---:|
| Flesh and Blood TCG Part The Mistveil Archive Booster Box Japanese Exclusive FaB | $70.00 | $99.99 | $73.67 | $80.99 | $25.32 | 36% |

## Cost-unknown items, costed from Inventory25 (read-only)

These 45 items had no Inventory26 cost in the first pass. The owner approved a one-time, read-only lookup of Inventory25 on Oct 9 (values only; no writes, formatting, sorting or notes; Sold 2025 not read). Only the derived per-item costs are kept here. Same rules and formulas as above (highest cost, tax-inclusive fee). Market prices are from the first pass; the lowest delivered price was fetched Oct 9.

### EASY: match market and stay profitable (20)

Ranked by the dollar drop from the current site price.

| Item | Cost (max) | Current site | TCG market | TCG lowest (delivered) | Proposed | Drop | PayPal fee | Ship est. (label / net) | Profit | Margin (of cost) | Break-even | Profit at current |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| FINAL FANTASY - Collector Booster Display | $435.00 | $2,499.99 | $1,666.85 | $1,661.75 | **$1,633.99** | −35% | $62.89 | $9.96 / $0.00 | $1,136.10 | 261% | $453.07 | $1,969.23 (453%) |
| Azur Lane Vol. 2 Booster Box Case † | $1,109.65 | $1,999.99 | $1,382.05 | $1,324.99 | **$1,354.99** | −32% | $52.30 | $23.05 / $12.06 | $180.98 | 16% | $1,166.87 | $801.50 (72%) |
| Riftbound: League of Legends Arcane Box Set | $79.99 | $999.99 | $529.52 | $494.98 | **$518.99** | −48% | $20.57 | $9.47 / $0.00 | $418.43 | 523% | $84.05 | $881.17 (1102%) |
| Mega Charizard X ex Ultra Premium Collection | $130.00 | $499.99 | $220.43 | $226.77 | **$216.99** | −57% | $9.11 | $9.47 / $0.00 | $77.88 | 60% | $136.04 | $350.14 (269%) |
| Phantasmal Flames Pokemon Center Elite Trainer Box (Exclusive) | $64.99 | $499.99 | $286.30 | $284.00 | **$280.99** | −44% | $11.54 | $9.47 / $0.00 | $204.46 | 315% | $68.46 | $415.15 (639%) |
| Battle Styles Booster Box | $155.00 | $399.99 | $283.93 | $263.69 | **$278.99** | −30% | $11.46 | $9.96 / $0.00 | $112.53 | 73% | $162.02 | $228.94 (148%) |
| Tarkir: Dragonstorm - Collector Booster Display | $300.00 | $599.99 | $496.76 | $479.74 | **$486.99** | −19% | $19.36 | $9.96 / $0.00 | $167.63 | 56% | $312.74 | $276.34 (92%) |
| FINAL FANTASY - Chocobo Bundle | $156.99 | $399.99 | $298.13 | $285.89 | **$292.99** | −27% | $11.99 | $9.47 / $0.00 | $124.01 | 79% | $164.09 | $226.95 (145%) |
| Stellar Crown Booster Box | $174.00 | $399.99 | $301.51 | $303.97 | **$295.99** | −26% | $12.11 | $9.96 / $0.00 | $109.88 | 63% | $181.77 | $209.94 (121%) |
| Ikoria: Lair of Behemoths - Booster Box | $170.00 | $299.99 | $241.63 | $237.99 | **$236.99** | −21% | $9.87 | $9.96 / $0.00 | $57.12 | 34% | $177.61 | $117.73 (69%) |
| Avatar: The Last Airbender - Commander's Bundle | $118.38 | $199.99 | $166.19 | $148.85 | **$162.99** | −18% | $7.06 | $9.47 / $0.00 | $37.55 | 32% | $123.96 | $73.15 (62%) |
| FINAL FANTASY - Bundle | $75.28 | $149.99 | $121.46 | $109.99 | **$119.99** | −20% | $5.43 | $9.47 / $0.00 | $39.28 | 52% | $79.16 | $68.14 (91%) |
| GODDESS OF VICTORY: NIKKE Booster Box | $50.00 | $99.99 | $77.21 | $72.76 | **$75.99** | −24% | $3.76 | $9.96 / $0.00 | $22.23 | 44% | $52.88 | $45.32 (91%) |
| Duskmourn: House of Horror - Play Booster Display | $118.00 | $219.99 | $202.11 | $199.99 | **$198.99** | −10% | $8.43 | $9.96 / $0.00 | $72.56 | 61% | $123.56 | $92.77 (79%) |
| Journey Together Elite Trainer Box | $99.00 | $150.99 | $136.30 | $124.99 | **$133.99** | −11% | $5.96 | $9.47 / $0.00 | $29.03 | 29% | $103.81 | $45.39 (46%) |
| Prismatic Evolutions Booster Bundle | $29.99 | $99.99 | $86.55 | $87.50 | **$84.99** | −15% | $4.10 | $6.11 / $0.00 | $50.90 | 170% | $32.08 | $65.33 (218%) |
| Morpeko V-UNION Playmat Premium Collection | $50.00 | $149.99 | $138.76 | $135.00 | **$135.99** | −9% | $6.03 | $9.47 / $0.00 | $79.96 | 160% | $52.88 | $93.42 (187%) |
| Scarlet & Violet Booster Box | $162.00 | $299.99 | $295.01 | $295.95 | **$289.99** | −3% | $11.88 | $9.96 / $0.00 | $116.11 | 72% | $169.30 | $125.73 (78%) |
| Edge of Eternities Commander Deck - World Shaper † | $40.00 | $59.99 | $51.93 | $53.85 | **$50.99** | −15% | $2.81 | $9.47 / $0.00 | $8.18 | 20% | $42.49 | $16.84 (42%) |
| 151 Booster Pack | $15.00 | $30.99 | $28.81 | $28.00 | **$27.99** | −10% | $1.94 | $6.11 / $0.00 | $11.05 | 74% | $16.50 | $13.94 (93%) |

### CLOSE: within about 10% of market at a safe profit (9)

"Proposed" is about 2% under market if that still clears 10% profit, otherwise the lowest safe price at 10% profit.

| Item | Cost (max) | Current site | TCG market | TCG lowest (delivered) | Proposed | Drop | PayPal fee | Ship est. (label / net) | Profit | Margin (of cost) | vs market | Break-even | Profit at current |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Surging Sparks Booster Box † | $270.00 | $399.99 | $301.31 | $299.00 | **$309.99** | −22% | $12.64 | $9.96 / $0.00 | $27.35 | 10% | +3% | $281.56 | $113.94 (42%) |
| Mega Evolution Enhanced Booster Box † | $279.00 | $379.99 | $292.44 | $289.85 | **$319.99** | −16% | $13.02 | $9.96 / $0.00 | $27.97 | 10% | +9% | $290.91 | $85.69 (31%) |
| Destined Rivals Booster Bundle † | $54.99 | $99.99 | $62.86 | $64.99 | **$63.99** | −36% | $3.30 | $6.11 / $0.00 | $5.70 | 10% | +2% | $58.07 | $40.33 (73%) |
| Mega Evolution Booster Bundle † | $60.00 | $99.99 | $67.04 | $69.79 | **$69.99** | −30% | $3.53 | $6.11 / $0.00 | $6.46 | 11% | +4% | $63.28 | $35.32 (59%) |
| Tarkir: Dragonstorm Commander Deck Case † | $229.75 | $299.99 | $276.69 | $279.95 | **$271.99** | −9% | $11.20 | $9.47 / $0.00 | $31.04 | 14% | at/under | $239.72 | $57.98 (25%) |
| Mega Evolution Elite Trainer Box [Mega Gardevoir] † | $99.00 | $139.99 | $119.84 | $115.00 | **$117.99** | −16% | $5.35 | $9.47 / $0.00 | $13.64 | 14% | at/under | $103.81 | $34.80 (35%) |
| Aetherdrift - Play Booster Display † | $100.00 | $137.99 | $110.70 | $112.12 | **$115.99** | −16% | $5.28 | $9.96 / $0.00 | $10.71 | 11% | +5% | $104.85 | $31.88 (32%) |
| Destined Rivals Sleeved Booster Pack † | $7.77 | $12.99 | $9.88 | $9.95 | **$9.99** | −23% | $1.25 | $6.11 / $0.00 | $0.97 | 12% | +1% | $8.98 | $3.85 (50%) |
| Mega Evolution Sleeved Booster Pack † | $7.77 | $11.99 | $9.62 | $8.25 | **$9.99** | −17% | $1.25 | $6.11 / $0.00 | $0.97 | 12% | +4% | $8.98 | $2.89 (37%) |

### CAN'T: market is below the safe floor (9)

Matching market would lose money or break the 10% rule. Options: keep the current price, or drop to the lowest safe price. Fee and profit columns are at the safe floor.

| Item | Cost (max) | Current site | TCG market | Lowest safe price | Floor vs market | PayPal fee | Ship est. | Profit at floor | Margin | Break-even | Profit at current |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| FINAL FANTASY Commander Deck - FINAL FANTASY VI Revival Trance † | $75.41 | $109.99 | $33.34 | $87.99 | +164% | $4.21 | $9.47 | $8.37 | 11% | $79.29 | $29.53 (39%) |
| FINAL FANTASY - Starter Kit † | $21.42 | $35.99 | $12.60 | $25.99 | +106% | $1.86 | $6.11 | $2.71 | 13% | $23.17 | $12.33 (58%) |
| Mega Lucario ex Premium Figure Collection † | $75.00 | $99.99 | $54.64 | $86.99 | +59% | $4.18 | $9.47 | $7.81 | 10% | $78.87 | $20.32 (27%) |
| Marvel's Spider-Man - Collector Booster Display † | $543.75 | $999.99 | $413.70 | $622.99 | +51% | $24.52 | $9.96 | $54.72 | 10% | $566.11 | $417.41 (77%) |
| Dual Impact Booster Box † | $193.00 | $269.99 | $154.25 | $221.99 | +44% | $9.30 | $9.96 | $19.69 | 10% | $201.52 | $65.87 (34%) |
| Marvel's Spider-Man - Bundle † | $75.28 | $99.99 | $63.67 | $86.99 | +37% | $4.18 | $9.47 | $7.53 | 10% | $79.16 | $20.04 (27%) |
| Avatar: The Last Airbender - Bundle † | $70.56 | $99.99 | $66.95 | $81.99 | +22% | $3.99 | $9.47 | $7.44 | 11% | $74.25 | $24.76 (35%) |
| Journey Together Booster Box † | $200.00 | $320.99 | $192.41 | $229.99 | +20% | $9.60 | $9.96 | $20.39 | 10% | $208.80 | $107.93 (54%) |
| Avatar: The Last Airbender - Collector Booster Display † | $491.40 | $666.99 | $478.71 | $562.99 | +18% | $22.24 | $9.96 | $49.35 | 10% | $511.69 | $149.40 (30%) |

### Already competitive (2)

| Item | Cost (max) | Current site | TCG market | Break-even | Profit at current | Margin | Note |
|---|---:|---:|---:|---:|---:|---:|---|
| 2 Pk Pokemon Surging Twilight with Token ◆ | $14.25 | $29.99 | $36.79 | $15.72 | $13.73 | 96% | **Market is for the wrong product:** TCGplayer id 609716 is "Prismatic Evolutions 2-Pack Blister [Eevee]", so the $36.79 comparison doesn't apply. Still profitable at $29.99 |
| Stellar Crown Sleeved Booster Pack | $2.92 | $10.99 | $11.48 | $3.94 | $6.78 | 232% | already at or below market |

### No TCGplayer market (5)

| Item | Cost (max) | Current site | Break-even | Lowest safe price | Profit at current | Margin |
|---|---:|---:|---:|---:|---:|---:|
| ZLCA DeckBox Prem Magnetic | $21.42 | $40.99 | $23.17 | $25.99 | $17.14 | 80% |
| ZLCA DeckBox | $11.00 | $25.99 | $12.34 | $13.99 | $13.13 | 119% |
| Clear Deckbox w/ Color Sleeves | $5.00 | $20.99 | $6.11 | $6.99 | $14.32 | 286% |
| Art Sleeves | $12.00 | $18.99 | $13.38 | $14.99 | $5.40 | 45% |
| Clear Sleeves | $4.00 | $10.99 | $5.07 | $5.99 | $5.70 | 143% |

### Data notes for the owner (nothing changed in the Sheet)

- **FINAL FANTASY Play Booster Display:** cost **$167** (owner confirmed Oct 9; Inventory25 row 87, 18 units). At $259.99: break-even $174.50, profit $82.25 (49%), list EASY. **Pending owner check:** Inventory26 row 17, "FINAL FANTASY - Play Booster Display - FINAL FANTASY (FIN)", qty 1, Cost w/ Tax $119.00, Total Inv $119.00, status "Sold out", TCG link product 618890 (same product). It may be a mismatch or a leftover; it doesn't affect the cost (highest = $167).
- **2 Pk Pokemon Surging Twilight with Token:** the website item's link (TCGplayer 609716) is "Prismatic Evolutions 2-Pack Blister [Eevee]", and Inventory25 row 78 "Pokemon Aloha First Starters" (2 in stock, $14.25) uses the same link, so the catalog merges those 2 units into this item. Its own row is row 74 (3 @ $9.99). Cost uses $14.25 (highest of the merged rows) to be safe. The $36.79 market doesn't apply.
- **Tarkir: Dragonstorm Play Booster Display:** Inventory25 row 105, "Wilds of Eldraine Play" (qty 0, $144.66), carries this item's TCGplayer link. It's a different product, so it's ignored; the cost is $100 (Inventory25 row 84, 12 units).
- **Tarkir: Dragonstorm Collector Booster Display:** Inventory25 row 123, "Godzilla Mat XL" (qty 0, $15), carries this item's link. Ignored.
- Inventory26 rows with stock but status "Sold out": FINAL FANTASY Play Booster Display (row 17), Origins (row 36), Marvel's Spider-Man Play Booster Display (row 20). The catalog still counts them as stock.
- Costs far below market, worth a glance: Riftbound Arcane Box Set $79.99, Phantasmal Flames Pokemon Center ETB $64.99, Stellar Crown Sleeved Booster Pack $2.92, FINAL FANTASY Collector Booster Display $435.

### Missing costs

- **None.** Every in-stock item has a non-zero unit cost.

## Files

- `data/price-proposal-2026-10-09.csv`: original 58 items, EASY and CLOSE rows (highest cost). `id` + `proposed_price` map onto `priceOverrides` in `data/store-settings.json`. **Not applied.**
- `data/price-proposal-2026-10-09-inv25.csv`: all 45 Inventory25-costed items (highest cost), every list. **Not applied.**
