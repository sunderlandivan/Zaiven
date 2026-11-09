# PreEminent Store — To-Do

## List on TCGplayer (in stock, not listed yet)

**Oct 30 fee-aware gap review (site in stock, not on TCG): nothing worth prioritizing.** After ~15% TCG fees + ≥15% profit on highest cost, Costco 6-pack is out (4 loose balls only), and the remaining gaps (Day / 151 / etc.) were not worth bringing up. Checklist below is backlog only — do not re-pitch unless the owner asks.

Use the Last Retail now in the sheet (market price, or the 10% profit minimum when market is too low) so TCGplayer matches the website.

**One Piece** — nothing listed on TCGplayer yet
- [ ] Two Legends - Booster Box (OP08)
- [ ] Adventure on Kami's Island Booster Box

**Pokémon**
- [ ] Perfect Order 3 Pack Blister [Chikorita]
- [ ] Pitch Black 3-Pack Blister [Binacle]
- [ ] Pokemon Day 2026 Collection
- [x] Costco 6-Pack Poke Balls — **do not list** (physical: 4 loose balls only; 6-pack SKU qty 0)
- [ ] Lumiose City Mini Tin Display
- [ ] 151 Booster Pack
- [ ] Delta Reign Booster Bundle
- [ ] Delta Reign Booster Box

**Magic**
- [ ] Lorwyn Eclipsed - Play Booster Display
- [ ] Avatar: The Last Airbender - Jumpstart Booster Display
- [ ] Marvel Super Heroes - Play Booster Display
- [ ] Marvel Super Heroes Commander Deck Case
- [ ] Secrets of Strixhaven - Bundle
- [ ] Secrets of Strixhaven - Play Booster Display
- [ ] Secrets of Strixhaven Commander Deck Case
- [ ] Reality Fracture - Collector Booster Display

**Flesh and Blood**
- [ ] Arcane Rising Booster Box [Unlimited Edition]
- [ ] Compendium of Rathe Booster Box
- [ ] Crucible of War Booster Box [Unlimited Edition]
- [ ] Tales of Aria Booster Box [Unlimited Edition]
- [ ] Welcome to Rathe Booster Box [Unlimited Edition]
- [ ] Omens of the Third Age Booster Box
- [ ] The Mistveil Archive Booster Box (Japanese) — also needs a TCG Link in the sheet

## Raise prices on TCGplayer

Agreed prices (website already uses these):
- [ ] Obsidian Flames Booster Box → $499
- [ ] Paradox Rift Booster Box → $399.99
- [ ] Usurp the Shadow Throne Booster Box → $114.86
- [ ] Destined Rivals Sleeved Booster Pack → $12
- [ ] Mega Lucario ex Premium Figure Collection → $99.99
- [ ] Marvel's Spider-Man - Play Booster Display → $299.99

Below the 10% profit minimum (website charges the minimum):
- [ ] Avatar: The Last Airbender - Play Booster Display → at least $155.94
- [ ] Avatar: The Last Airbender - Collector Booster Display → at least $637.87
- [ ] Mega Evolution Enhanced Booster Box → at least $362.30
- [ ] Aetherdrift - Play Booster Display → at least $131.36
- [ ] Dual Impact Booster Box → at least $251.71

## Check

- [x] **After physical inventory (Nov 3–4):** compare current Sheet qtys to original baseline `data/physical-inventory-baseline-pre-2026-11-03.json` (what the sheet had before the count). Live audit: `data/physical-inventory-diff-live.json` (2026-11-06).
- [x] Origins - Proving Grounds Box Set — checked TCGplayer 2026-10-30: marketplace + photo listings all **qty 0** (not for sale / not on public seller results). No live stock to remove.
- [ ] After updating TCGplayer, send fresh CSV exports so the store and sheet pick up the new prices.

## Go-live

- [x] Buy preeminentstore.com on Cloudflare Registrar; site live at preeminentstore.com and www.
- [x] Email: sales@preeminentstore.com forwards to iv3nsun@gmail.com (Cloudflare Email Routing).
- [x] Convert PayPal to a Business account (The PreEminent Store LLC, sales@preeminentstore.com).
- [x] PayPal checkout live (PayPal, Venmo, Pay Later, debit/credit card); verifies real stock and US address before charging.
- [x] California sales tax on website checkout — live (`salesTax.enabled`). See `docs/sales-tax.md`. Remaining = CDTFA filing/remit + quarterly rate checks (not a go-live decision).
- [ ] Optional: switch the store contact email to sales@preeminentstore.com.
- [ ] Stripe: not needed for now, since PayPal takes cards without an account.
- [x] Order confirmation emails (Resend) — domain `preeminentstore.com` verified, sending enabled, `RESEND_API_KEY` on Pages. Confirms go out on paid / awaiting-payment website orders.

## Marketing

- [x] Instagram bio link: preeminentstore.com (+ links list) on @thepreeminentstore.
- [x] Google Merchant Center (free listings): feed live; **Counterfeit cleared Oct 31** (issue no longer on account). Keep decks off Shopping.
- [x] Google Search Console: preeminentstore.com / sitemap (redirect noise on intentional 301s is expected).
- [ ] Cloudflare: Workers & Pages -> preeminentstore -> Metrics -> enable Web Analytics (free visitor stats).
- [x] Marketing agent lives in Zaiven (`docs/marketing-agent.md`, `scripts/marketing/`). Old `preeminent-marketing` repo archived.
