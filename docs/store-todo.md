# PreEminent Store — To-Do

## List on TCGplayer (in stock, not listed yet)

Use the Last Retail now in the sheet (market price, or the 10% profit minimum when market is too low) so TCGplayer matches the website.

**One Piece** — nothing listed on TCGplayer yet
- [ ] Two Legends - Booster Box (OP08)
- [ ] Adventure on Kami's Island Booster Box

**Pokémon**
- [ ] Perfect Order 3 Pack Blister [Chikorita]
- [ ] Pitch Black 3-Pack Blister [Binacle]
- [ ] Pokemon Day 2026 Collection
- [ ] Costco 6-Pack Poke Balls
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

- [ ] Origins - Proving Grounds Box Set: listed on TCGplayer (qty 1) but not in the sheet — add it to the sheet or delist it.
- [ ] After updating TCGplayer, send fresh CSV exports so the store and sheet pick up the new prices.

## Go-live

- [x] Buy preeminentstore.com on Cloudflare Registrar; site live at preeminentstore.com and www.
- [x] Email: sales@preeminentstore.com forwards to iv3nsun@gmail.com (Cloudflare Email Routing).
- [x] Convert PayPal to a Business account (The PreEminent Store LLC, sales@preeminentstore.com).
- [x] PayPal checkout live (PayPal, Venmo, Pay Later, debit/credit card); verifies real stock and US address before charging.
- [ ] Decide on California sales tax (seller's permit; collect on California orders?). Checkout currently adds no tax.
- [ ] Optional: switch the store contact email to sales@preeminentstore.com.
- [ ] Stripe: not needed for now, since PayPal takes cards without an account.
- [ ] Order confirmation emails (free, Resend). The code is already live. It starts sending as soon as the key is set:
  1. Go to https://resend.com and sign up for a free account. Use iv3nsun@gmail.com or sales@preeminentstore.com.
  2. In Resend, click **Domains**, then **Add Domain**. Type `preeminentstore.com` and pick region **North Virginia (us-east-1)**. Click **Add**.
  3. Resend now shows about 3 DNS records: a **TXT** named `resend._domainkey`, plus an **MX** and a **TXT** both named `send`. Keep that page open.
     - If Resend offers an **Auto configure** or **Sign in to Cloudflare** button, you can use that instead and skip to step 5.
  4. In another tab, open https://dash.cloudflare.com, click **preeminentstore.com**, then **DNS**, then **Records**. For each record Resend shows, click **Add record**:
     - Set **Type** to whatever Resend says (TXT or MX).
     - For **Name**, copy only the part Resend shows, like `resend._domainkey` or `send`. Cloudflare adds `.preeminentstore.com` itself.
     - For **Content** (or **Mail server**), click Resend's copy button and paste. For the MX record, set **Priority** to `10`.
     - Click **Save**.
     - **Do not edit or delete anything that's already there.** That includes the three `route1/2/3.mx.cloudflare.net` MX records and the TXT on `preeminentstore.com` that starts with `v=spf1 include:_spf.mx.cloudflare.net`. Those make sales@ forwarding work.
     - About SPF: a domain name can only have one `v=spf1` record. That's not a problem here, because Resend's SPF goes on `send`, not on the main domain. If Resend ever asks for an SPF on the main `preeminentstore.com` name, don't add a second one. Edit the existing one and put the new `include:` before `~all`, e.g. `v=spf1 include:_spf.mx.cloudflare.net include:amazonses.com ~all`.
     - Optional, but helps keep mail out of spam: add a **TXT** with Name `_dmarc` and Content `v=DMARC1; p=none;`.
  5. Back in Resend, click **Verify DNS Records**. It can take a few minutes, sometimes up to an hour, to say **Verified**.
  6. In Resend, click **API Keys**, then **Create API Key**. Name it `preeminentstore`, set Permission to **Sending access** and Domain to `preeminentstore.com`, then click **Add**. Copy the key. It starts with `re_` and is only shown once.
  7. Give the key to the agent in chat. The agent will run `node node_modules/wrangler/bin/wrangler.js pages secret put RESEND_API_KEY --project-name preeminentstore` from `cloudflare/`. Or set it yourself in Cloudflare: **Workers & Pages**, then **preeminentstore**, **Settings**, **Variables and Secrets**, **Add**. Pick Type **Secret**, Name `RESEND_API_KEY`, paste the key as the Value, then **Save**. The agent then redeploys so it takes effect.
  - Free plan: 3,000 emails/month and 100/day. Each order uses 2, one to the buyer and one copy to sales@, so that's about 50 orders a day.

## Marketing

- [ ] Instagram bio link: https://preeminentstore.com/links
- [ ] Google Merchant Center (free listings): sign up, verify preeminentstore.com, add feed https://preeminentstore.com/feed.xml (daily fetch), set shipping to match the store.
- [ ] Google Search Console: add preeminentstore.com and submit https://preeminentstore.com/sitemap.xml.
- [ ] Cloudflare: Workers & Pages -> preeminentstore -> Metrics -> enable Web Analytics (free visitor stats).
- [ ] Create private GitHub repo preeminent-marketing and connect it to the daily Cursor marketing automation.
