# PreEminent Store — Hub handoff (primary laptop)

**Purpose:** This machine is the **primary ops hub** for The PreEminent Store. Any new Agent on this laptop should read this file first and treat it as the operating charter. Continuity lives here and in `docs/` + git — **not** in old Cursor chats tied to other repos.

**Repo:** https://github.com/sunderlandivan/Zaiven (`main`)  
**Preferred folder:** `OneDrive\Documents\Cursor\TCG`  
**Live site:** https://preeminentstore.com (Cloudflare Pages project `preeminentstore`)  
**Do not use as hub:** Cursor projects `thepreeminentstore.github.io` or `preeminent-marketing` (optional Shorts/playbook only). The store code, portal, inventory, and Google fixes live in **this** repo.

**Last packaged:** 2026-10-26 (from previous primary PC → GitHub `main`).

---

## A) Bootstrap this laptop (do once)

1. Auth GitHub as **sunderlandivan** for this repo (account `ThePreEminentStore` gets 403 on Zaiven).
2. Open or clone into `OneDrive\Documents\Cursor\TCG`. Prefer the OneDrive path so `data\` and inventory photos sync.
3. `git pull --ff-only origin main` (or run `scripts/setup-hub-laptop.ps1`).
4. Ensure **`data\`** is present and non-empty (PayPal/YouTube/Resend-style credentials, inventory DBs, `store-settings.json`, orders, etc.). **Gitignored — never commit.** Copy from the old PC’s OneDrive TCG `data\` if missing.
5. `npm install` → `npm start` (port **5173**). Confirm inventory UI loads.
6. User env (Windows): `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REDIRECT_URI`.
7. Cloudflare deploys: `npx wrangler login` once when needed. Secrets stay in the Cloudflare dashboard.
8. Report back: path, `git rev-parse --short HEAD`, `data\` file count, server up?, missing env.

---

## B) Permanent scope (you own all of this)

| Area | Where |
|------|--------|
| Local inventory portal / Node API | `server/`, `public/inventory*` |
| Storefront + checkout + feed/sitemap | `storefront/`, `cloudflare/` |
| Cloud portal (sold / web orders / status) | `cloudflare-portal/` |
| Merchant Center / Shopping / GSC | Live site + `docs/merchant-center-*.md` |
| Physical inventory | OneDrive `Pictures\Inventory` → Sheet + local stock |
| Sheet ledger | Inventory26 / Inventory25; sales → **Sold 2026** only |
| Sales intake (Gmail / eBay / PayPal / web) | `server/` intake + `data\` |
| Pricing proposals / raise-after-sale | Propose only; Marketing UI; never auto-apply |
| Ops docs | Update relevant `docs/` when status changes |

---

## C) Hard rules (always-on; also in `.cursor/rules/`)

1. **Sold 2025 is locked** — never write/edit/delete.
2. **Inventory25** may be adjusted (older stock still on hand). **New sales → Sold 2026 only.**
3. **No price changes** without owner explicit OK. Flow: audit → propose with cost/fees/profit → wait → apply. Never below cost + fees. Cost = **highest** unit cost across rows. Existing items ≥**15%** profit on cost after fees; new items ≥**10%**. Owner-reviewed prices in `docs/price-proposal-2026-10-09.md` are locked.
4. **Merchant Center:** never change business name / website / business info while a review is pending.
5. **Custom decks:** sell on-site OK; **never** put back in `feed.xml`, sitemap, or Product JSON-LD; keep **noindex** on deck product pages (`cloudflare/lib/catalog.js` helpers).
6. Never commit credentials, oauth tokens, or `data/*.json`.
7. After changes under `server/`, restart Node on 5173 (see `.cursor/rules/restart-node-server.mdc`).

---

## D) Current status snapshot (2026-10-26)

### Google Merchant Center (account `5871019770`)

- **Counterfeit** suspension. Oct 16 review **rejected**. Oct 26: stronger fix deployed (feed exclude decks, sitemap omit decks, deck pages noindex / no Product LD) + **new review requested**.
- Full timeline + appeal text: `docs/merchant-center-counterfeit-2026-10-16.md`
- If Google asks for identity / invoices → **owner only**. Do not reintroduce decks to Shopping surfaces.

### Site / GSC / GCR

- www → apex **single-hop** 301; `.html` → clean URLs (`cloudflare/functions/_middleware.js` + CF rule).
- Google Customer Reviews opt-in on PayPal thank-you path.
- Intentional redirects may show as “Page with redirect” in GSC — expected.

### Physical inventory (~30% done)

Photo root: `OneDrive\Pictures\Inventory`  
**Locked counts so far** (do not overwrite without re-count / owner OK):

| Item | Count note |
|------|------------|
| Uprising | 11 cases |
| Compendium | 4 |
| Usurp | 3 shown |
| Charizard | 10 |
| Paradox | 1 |
| 30th Celebration | ETB 5, PC 2, bundles 6 |
| Knock Out | 1 |
| Perfect Order | 2 PC + 1 regular |
| MTG sealed | play case = **1** unit |

Continue remaining photo batches → confirm with owner → Sheet + stock.

### Open store ops (see also `docs/store-todo.md`)

- TCGplayer listings still needed for several in-stock SKUs.
- Agreed TCGplayer price raises listed in `docs/store-todo.md` (website already at those; TCG listing updates still open).
- Year-end / tax notes in `docs/sold-2026-ytd.md` and `docs/sales-tax.md`.

---

## E) Key doc index

| Doc | Why |
|-----|-----|
| `docs/merchant-center-counterfeit-2026-10-16.md` | MC Counterfeit — live issue |
| `docs/merchant-center-misrepresentation-2026-10-13.md` | Prior MC issue (cleared) |
| `docs/price-proposal-2026-10-09.md` | Locked owner price decisions |
| `docs/limited-items-rule.md` | Show-1 / raise rules |
| `docs/store-todo.md` | Listing / raise checklist |
| `docs/sales-tax.md` | CA collection rules |
| `docs/sold-2026-ytd.md` | YTD / tax prep notes |
| `docs/name-image-audit-2026-10-14.md` | Catalog name/image mismatches |
| `docs/portal-cloud-plan.md` | Cloud portal design |
| `.cursor/rules/*.mdc` | Always-applied agent rules |

---

## F) Default operating mode

When the owner messages this Agent: diagnose → change repo/data/Sheet carefully → deploy/restart as needed → update the relevant docs → report what changed and **what needs owner OK** (prices, irreversible Sheet edits, Google identity steps).

You own the full pipeline on this laptop: **portal, website, Google issues, physical inventory, and Sheet updates.**
