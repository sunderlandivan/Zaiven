# PreEminent Store — Full console handoff

**This file replaces the old PC’s Cursor console.** A blank laptop that clones Zaiven, restores `data\`, applies env from the transfer pack, and follows this doc should continue **all** PreEminent Store work with no dependence on the previous machine’s chat history.

| | |
|--|--|
| **Repo** | https://github.com/sunderlandivan/Zaiven (`main`) |
| **Folder** | `OneDrive\Documents\Cursor\TCG` |
| **Site** | https://preeminentstore.com |
| **Portal media** | https://portal.preeminentstore.com |
| **Local app** | http://localhost:5173 (`npm start`) |
| **Sheet** | spreadsheet id `1LkMac4otBWqBpvxsLUe3lsHjdi79-OQZGVGDJwFSKcY` (via Gmail OAuth + Sheets scope) |
| **MC account** | The PreEminent Store `5871019770` |
| **GitHub auth** | **sunderlandivan** (not `ThePreEminentStore` — that account 403s on Zaiven) |
| **Packaged** | 2026-10-26 |

**Not the hub:** Cursor chats under `thepreeminentstore.github.io` or `preeminent-marketing`. Optional Shorts/playbook only. Code + inventory + portal + Google fixes = **this repo**.

**Transfer pack (secrets, not in git):**  
`OneDrive\Documents\Cursor\TCG-HUB-TRANSFER-<date>\` (and `.zip`) — created by `scripts/pack-hub-transfer.ps1` on the old PC. Contains full `data\` + `set-user-env.ps1` + `INSTALL.txt`.

---

## 1) Blank-laptop bootstrap

Do in order. Details also in the transfer pack’s `INSTALL.txt`.

1. Install **Git**, **Node.js LTS**, **Cursor**. Same **OneDrive** Microsoft account. GitHub as **sunderlandivan**.
2. Clone:  
   `git clone https://sunderlandivan@github.com/sunderlandivan/Zaiven.git`  
   into `OneDrive\Documents\Cursor\TCG`.
3. Copy transfer pack **`data\*`** → `TCG\data\`.
4. Run transfer pack **`set-user-env.ps1`** (User env: Gmail OAuth client + any API keys). **Quit and reopen Cursor.**
5. `npm install` → `npm start` → confirm http://localhost:5173.
6. Confirm OneDrive `Pictures\Inventory` is syncing (physical count photos).
7. Cloudflare later: `npx wrangler login`. Pages project **`preeminentstore`**; portal under `cloudflare-portal/`.
8. Report: path, `git rev-parse --short HEAD`, `data\` file count, server up, env present, inventory photos path OK.

Helper: `scripts/setup-hub-laptop.ps1` (code/deps only — still need the transfer pack for `data\` + env).

---

## 2) What “the console” owns (everything)

| Work | Location |
|------|----------|
| Inventory UI, sales intake, orders, stock, marketing, tax, sheet sync, loans, treasure hunt | `server/`, `public/inventory*` |
| Public store + PayPal + feed/sitemap/product SEO | `storefront/`, `cloudflare/` |
| Cloud portal (sold / web orders / status / users) | `cloudflare-portal/` |
| Merchant Center / Shopping / GSC | Live site + `docs/merchant-center-*.md` |
| Physical inventory | `Pictures\Inventory` → Sheet + `data\` stock |
| Sheet ledger | **Inventory26** / **Inventory25**; sales → **Sold 2026** only |
| Raise-after-sale / price proposals | Propose for owner OK; never auto-apply |
| Ops memory | Update `docs/` when status changes |

Day-to-day: diagnose → change repo/data/Sheet carefully → restart/deploy → update docs → say what needs **owner OK**.

---

## 3) Hard rules (also `.cursor/rules/`)

1. **Sold 2025 locked** — no writes.
2. **Inventory25** adjustable; **new sales → Sold 2026 only**.
3. **No price changes** without explicit owner OK. Audit → propose (cost, fees, profit) → wait → apply. Never below cost+fees. Cost = **highest** unit cost across rows. Existing ≥**15%** profit on cost after fees; new ≥**10%**. Locked decisions: `docs/price-proposal-2026-10-09.md`.
4. Fees model: PayPal **3.49%** of (price + shipping charged + worst-case CA tax) + **$0.49**; shipping label − shipping charged; tax is pass-through. TCGplayer ~**13%** when quoting TCG.
5. **MC:** do not change business name / website / business info during reviews.
6. **Custom decks:** on-site OK; **never** in `feed.xml`, sitemap, or Product JSON-LD; keep **noindex** (`cloudflare/lib/catalog.js`).
7. Never commit `data/*.json`, credentials, oauth tokens, or transfer `set-user-env.ps1`.
8. After `server/` changes, restart Node on **5173** automatically.

---

## 4) Architecture cheat sheet

```
Owner browser
  → localhost:5173  Node (server/index.js)  ← inventory portal, Gmail/Sheets, publish to KV
  → preeminentstore.com  Cloudflare Pages + Functions  ← shoppers, PayPal, feed.xml, sitemap
  → portal.preeminentstore.com  cloudflare-portal  ← cloud views / lease
Google Sheet  ←→  server sheetLedger + Gmail OAuth (Sheets scope)
Merchant Center  ←  https://preeminentstore.com/feed.xml  (no custom decks)
```

- Publish / stock / catalog: `server/storePublish.js`, `server/storeCatalog.js`, KV binding `STORE`.
- PayPal: `cloudflare/functions/api/paypal/*` + `data/paypal-credentials.json` / wrangler secrets as configured.
- Gmail intake: `server/gmailOrders.js`, `server/emailIntake.js`.
- Restart pattern: `.cursor/rules/restart-node-server.mdc`.

---

## 5) Status inherited from previous console (2026-10-26)

### Merchant Center — Counterfeit (active)

- Suspended for Counterfeit; Oct 16 review **rejected** (decks still crawlable).
- Oct 26 hardening deployed: feed exclude decks, sitemap omit deck URLs, deck PDPs **noindex** / no Product LD; **new review requested Oct 26**.
- Full log + appeal language: `docs/merchant-center-counterfeit-2026-10-16.md`.
- Identity / invoice requests → **owner only**. Do not put decks back on Shopping surfaces.
- Prior Misrepresentation issue was cleared earlier (`docs/merchant-center-misrepresentation-2026-10-13.md`).

### Site / GSC / GCR

- www → apex **single-hop** 301; `.html` → clean URLs.
- Google Customer Reviews opt-in on PayPal thank-you.
- GSC “Page with redirect” on intentional redirects = expected.

### Physical inventory (~30%)

Photos: `OneDrive\Pictures\Inventory`  
**Locked counts** (do not overwrite without re-count + owner OK):

| Item | Count |
|------|--------|
| Uprising | 11 cases |
| Compendium | 4 |
| Usurp | 3 shown |
| Charizard | 10 |
| Paradox | 1 |
| 30th Celebration | ETB 5 / PC 2 / bundles 6 |
| Knock Out | 1 |
| Perfect Order | 2 PC + 1 regular |
| MTG sealed | play case = **1** unit |

Continue remaining batches → confirm → Sheet + stock.

### Pricing / marketing

- Oct 9 audit: **no prices changed**; owner decisions locked in `docs/price-proposal-2026-10-09.md`.
- Raise-after-sale: propose on Marketing (`raiseAfterSale` in `data/store-settings.json`); never auto-apply.
- Open listing / TCG raise checklist: `docs/store-todo.md`.

### Contact / brand

- Customer email: `sales@preeminentstore.com` (forwarding configured).
- Do not invent new public business identity during Google reviews.

---

## 6) Doc index (read when relevant)

| Doc | Topic |
|-----|--------|
| `docs/HUB-AGENT-PROMPT.md` | First message for the new Agent |
| `docs/merchant-center-counterfeit-2026-10-16.md` | Live MC issue |
| `docs/price-proposal-2026-10-09.md` | Locked prices |
| `docs/limited-items-rule.md` | Limited / show-1 rules |
| `docs/store-todo.md` | Listings & TCG raises |
| `docs/sales-tax.md` | CA tax |
| `docs/sold-2026-ytd.md` | YTD / tax prep |
| `docs/name-image-audit-2026-10-14.md` | Name/image mismatches |
| `docs/portal-cloud-plan.md` | Cloud portal |
| `docs/weekly-shorts.md` | Shorts pipeline |
| `.cursor/rules/*.mdc` | Always-on agent rules |

---

## 7) First reply checklist (new Agent)

After bootstrap, reply with:

1. Hub path + git short SHA + `data\` file count + server status  
2. Confirmation you own portal, website, Google, physical inventory, Sheet updates  
3. Anything still missing (env, photos, wrangler, OneDrive)  
4. That you will keep using **this** chat as the moved console  

Then wait for the owner’s next ops task — do not stop at “setup done.”
