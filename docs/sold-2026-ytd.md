# The PreEminent Store LLC — 2026 Schedule C prep worksheet (YTD through Oct 12, 2026)

> **Informational only — not tax advice.** These figures are organized to make the preparer's job easier. Confirm every line, and the treatment of anything flagged below, with your tax preparer before filing.

Prepared Oct 12, 2026 and refreshed Oct 13, 2026 from the order data the store actually received:
- **TCGplayer** — 151 orders from the seller portal (real fees, taxes and refunds), through order DC5D041D-3AED7B-7FCF1 on 10/12.
- **eBay** — 32 orders from Seller Hub order details (price, shipping, fees incl. ad fees, eBay-collected tax, refunds, label cost). Re-checked Oct 13: no eBay orders after 8/16.
- **Website / PayPal / Zelle / Venmo** — 1 paid order (INV-0001, Facebook buyer, PayPal invoice).
- **Manual / in-person sales** entered in the portal: none recorded in 2026 so far.

Canceled orders are excluded from sales. Numbers are regenerated with `node scripts/sold-2026-reconcile.mjs` then `node scripts/sold-2026-ytd.mjs` (writes `data/sold-2026-ytd.json`).

---

## Part I — Income

| Line | Item | Amount |
|---|---|---:|
| 1 | **Gross receipts** (product sales $21,267.19 + shipping charged to buyers $1,132.81) | **$22,400.00** |
| 2 | Returns and allowances (refunds on completed orders) | $122.98 |
| 3 | Line 1 − Line 2 | $22,277.02 |
| 4 | Cost of goods sold (Part III — needs the year-end count) | *see Part III* |

**Not income — excluded from Line 1 and shown separately:**

| Sales tax | Amount | Treatment |
|---|---:|---|
| Marketplace-facilitator tax collected & remitted by TCGplayer | $1,436.64 | Platform remits; not our receipts |
| Marketplace-facilitator tax collected & remitted by eBay (incl. retail delivery fees) | $107.05 | Platform remits; not our receipts |
| **Sales tax we collected (owed to CDTFA)** | **$0.00** | Only website order shipped to Ohio, no CA tax charged |

**Line 2 detail (partial refunds):**
- TCGplayer DC5D041D-C4437D-ED53D — $119.98 (2 of 3 Abzan Armor commander decks refunded; the Sold row still shows 3 sold).
- eBay 20-14706-72619 — $3.00 (seller-paid part of a $3.21 refund; eBay covered $0.21).

**Possible additional receipts to verify (not in Line 1):** these Sold 2026 rows have no matching order on any channel. If they were real off-platform sales, add them to Line 1:
- "MAGIC Ikoria: Lair of Behemoths Play Booster", 3/8 — $210.00 + $10.99 shipping (a second Ikoria row; may be a duplicate).
- "FINAL FANTASY – Chocobo Bundle", 7/13 — $249.99 + $10.99 shipping (a second Chocobo row; may be a duplicate).
- Two $0 rows on 7/13 (Marvel Super Heroes Play Booster Display ×2, TMNT Commander Deck) — no money involved; possibly giveaways/personal use, which affect inventory, not income.

## Part II — Expenses gathered so far

| Line | Item | Amount | Notes |
|---|---|---:|---|
| 10 | Commissions and fees — TCGplayer | $2,794.68 | Actual, from the seller portal |
| 10 | Commissions and fees — eBay | $252.36 | Actual final value + per-order + ad fees |
| 10 | Commissions and fees — PayPal | $33.99 | Actual (INV-0001) |
| 10 | **Total Line 10** | **$3,081.03** | |
| 10 | *Fees on canceled orders — verify* | *up to $62.44* | TCGplayer $61.24 across 6 canceled orders; eBay $1.20 ($0.40 × 3). Include only what the payout statements show was actually kept. |
| 27a | **Postage — shipping labels** (recorded) | **$834.34** | 86 of 173 orders: TCGplayer $620.72 (58 orders), eBay $185.18 (27), website $28.44 (1). Labels for the other ~87 orders were bought elsewhere — gather USPS / Pirate Ship / TCGplayer label receipts. |
| 22 | Supplies — packing materials | *gather* | Mailers, top loaders, boxes, tape (not postage) |

## Part III — Cost of goods sold (Line 4)

| Line | Item | Amount | Status |
|---|---|---:|---|
| 35 | Inventory at beginning of year (1/1/2026) | **confirm** | Must equal the **2025 return's ending inventory**. Our records disagree: the 2025 year-end import shows **$42,196.44**; the 1/1/2026 inventory snapshot shows **$64,338.97**. Use the figure on the filed 2025 return. |
| 36 | Purchases (2026) | **confirm** | Inventory26 tab "Grand Total Inv $" today: **$69,441.84**. July 13 import of the same tab: $50,772.75. Caveat: rows sold through the app have had Qty lowered and restocks average the unit cost, so the tab understates some purchases — reconcile against supplier receipts / card statements. |
| 37–39 | Labor / materials / other costs | — | None tracked |
| 41 | Inventory at end of year (12/31/2026) | **to be filled after the physical count** | Count every item on hand at year end, valued at actual cost |
| 42 | COGS = 35 + 36 − 41 | — | After the count |

### Cross-check: per-sale COGS (specific identification, actual cost)

| Measure | Amount |
|---|---:|
| Sold 2026 "Cost w/ Tax" total (cost as written on each sold row) | $13,035.28 |
| Lines where the exact stock row was identified — **actual cost** | **$8,815.35** (65 lines) |
| Same lines at the **highest-cost** pricing baseline | $8,911.35 |
| Difference | $96.00 — Final Fantasy Play Booster Display ×2, actual $119/unit vs highest $167/unit |

- **Taxes should use actual cost (specific identification).** The "highest unit cost" rule is the store's *pricing* safety baseline only; it is not the tax cost. The sheet's single cost column keeps whatever the app/owner wrote (actual cost of the row sold from).
- The Part III formula (35 + 36 − 41) is what goes on the return; the per-sale total is a sanity check. A large gap between them usually means a missing purchase, a miscounted ending inventory, or unrecorded giveaways/personal use.
- **Cost not determinable per sale** (128 order lines, $6,084.72 of sales): 85 TCGplayer singles (pulled from packs/collections; the sheet records $0), 11 TCGplayer sealed lines with no confident stock-row match (the sheet row carries the owner's cost), and 32 eBay lines (custom premade decks, tokens, playmats, collectibles; the eBay rows mostly carry owner-entered cost). Two new backfilled rows have a **blank** cost: Astral Radiance Booster Pack ×2 (DC5D041D-4078DF-FED62) and Hyper Aroma single (DC5D041D-38E0D1-C97A8).

---

## By channel

| Channel | Orders | Product | Shipping charged | Gross (Line 1) | Refunds | Fees | Labels (recorded) | Platform tax (excluded) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| TCGplayer | 145 | $19,038.39 | $922.55 | $19,960.94 | $119.98 | $2,794.68 | $620.72 | $1,436.64 |
| eBay | 27 | $1,268.80 | $210.26 | $1,479.06 | $3.00 | $252.36 | $185.18 | $107.05 |
| Website (Facebook / PayPal invoice) | 1 | $960.00 | $0.00 | $960.00 | $0.00 | $33.99 | $28.44 | $0.00 |
| Manual / in-person | 0 | — | — | — | — | — | — | — |
| **Total** | **173** | **$21,267.19** | **$1,132.81** | **$22,400.00** | **$122.98** | **$3,081.03** | **$834.34** | **$1,543.69** |

Canceled and excluded (11): TCGplayer DC5D041D-86F00B-ED306 ($160.98), -14E4A1-A5FDA ($5.39), -030A7A-E29ED ($3.58), -4E6DE2-0D2BF ($2.49), -51628B-7869A ($130.98), -76D24D-D5659 ($110.98); eBay 02-15056-82022 ($16.23), 07-14823-91478 ($125.00), 22-14659-65099 ($73.73), 15-14627-02442 ($131.83), 17-14570-32199 ($12.94). Junk record E402B8AB-C0FB7C-073D4 ignored.

## By month

| Month | Orders | Product | Shipping | Gross | Refunds | Fees | Labels | Platform tax |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Jan | 17 | $1,170.64 | $87.54 | $1,258.18 | — | $188.12 | $50.99 | $98.04 |
| Feb | 11 | $790.00 | $82.93 | $872.93 | — | $135.58 | $69.96 | $65.55 |
| Mar | 19 | $4,268.04 | $183.63 | $4,451.67 | — | $653.43 | $151.55 | $304.57 |
| Apr | 16 | $2,591.36 | $112.11 | $2,703.47 | — | $339.00 | $94.90 | $191.77 |
| May | 13 | $2,474.86 | $151.85 | $2,626.71 | — | $383.08 | $112.15 | $185.83 |
| Jun | 30 | $1,539.54 | $164.42 | $1,703.96 | $3.00 | $258.44 | $98.04 | $133.61 |
| Jul | 17 | $3,417.81 | $142.60 | $3,560.41 | $119.98 | $478.24 | $106.73 | $259.40 |
| Aug | 21 | $1,426.93 | $91.15 | $1,518.08 | — | $206.86 | $39.43 | $113.60 |
| Sep | 16 | $1,262.90 | $81.24 | $1,344.14 | — | $197.98 | $66.18 | $66.32 |
| Oct (to 10/12) | 13 | $2,325.11 | $35.34 | $2,360.45 | — | $240.30 | $44.41 | $125.00 |
| **YTD** | **173** | **$21,267.19** | **$1,132.81** | **$22,400.00** | **$122.98** | **$3,081.03** | **$834.34** | **$1,543.69** |

## Order records vs the Sold 2026 tab

Every 2026 order now has a row in Sold 2026 with its order number in the new **Order #** column. The tab's totals row differs from the order data because of owner-entered batch rows and a few price differences:

| | Sold 2026 tab | Orders | Why they differ |
|---|---:|---:|---|
| Product sales | $21,851.02 | $21,267.19 | Duplicated $203.52 "Mind Stone" batch row; the unverified Ikoria and Chocobo rows; a few rows entered below the actual price (e.g. OTJ case $909.36 vs $999.99, Riftbound $190.46 vs $212.01, Prismatic $979.74 vs $999.96) |
| Shipping charged | $1,169.26 | $1,132.81 | Same rows; a few shipping differences (e.g. Costco 2-pack $10.99 vs $24.99) |
| Fees | $3,127.13 | $3,081.03 | Some rows carry intake estimates (e.g. the 10/12 Cogwerx row: $1.25 estimated vs $1.33 actual); website row's Fees includes the $28.44 label (also in Label Cost) |

Items for the owner to fix on the tab (each row is annotated in the **Notes** column):
- **Marvel singles batch (7/13):** the "Marvel Single Assorted" row stands for 20 TCGplayer singles orders from 6/26 to 7/07 (actual product $236.30 + shipping $28.04). The separate "Mind Stone" row repeats the same $203.52, so it looks double-counted.
- **Gundam Heroic Beginnings Starter row (1/24):** this lines up with TCGplayer order DC5D041D-76D24D-D5659, which was **canceled**. If no other sale happened, the row overstates sales.
- **Canceled orders previously logged by the intake:** Tarkir (86F00B) and two small singles orders were logged and later removed from the tab. The Tarkir intake had already lowered Inventory26 Qty — re-check that row's count.

## Checklist — other deductible categories to gather (no amounts estimated)

- [ ] Shipping labels not bought through the app/eBay (USPS, Pirate Ship, TCGplayer label purchases) — Line 27a
- [ ] Packing supplies: mailers, boxes, top loaders, sleeves, tape, labels/printer stock — Line 22
- [ ] Software & subscriptions: TCGplayer Pro/seller tools, eBay store subscription, website hosting/domain, Google Workspace, pricing tools — Line 18 or 27a
- [ ] Advertising: eBay promoted listings beyond those already in eBay fees, Facebook/Instagram ads, show/table fees — Line 8
- [ ] Event and convention table fees, LGS consignment fees — Line 10 or 27a
- [ ] Bank, card-processing and Zelle/Venmo business fees not shown above — Line 27a
- [ ] Office expenses: printer, ink, card scanner, shelving — Line 18 (equipment may be Line 13 depreciation/Section 179)
- [ ] Business mileage for post office / supplier runs (log of dates and miles) — Line 9
- [ ] Home office (if the space is used regularly and exclusively for the business) — Line 30 / Form 8829
- [ ] Phone/internet business-use share — Line 25 or 27a
- [ ] Inventory given away, used personally or damaged (reduces ending inventory; document it)
- [ ] Physical inventory count on 12/31/2026 at actual cost — Part III Line 41
- [ ] 1099-K forms from TCGplayer, eBay and PayPal — reconcile to Line 1 (1099-K gross can include tax and shipping)
- [ ] CDTFA: confirm no CA sales tax return is due beyond marketplace-facilitator sales (we collected $0.00 directly)
