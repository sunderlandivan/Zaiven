# Portal in the cloud: private, always on, $0

Goal: the portal keeps working when the PC is off, only the owner can open it, and it costs nothing. That means no card or other payment method on file, and no plan that bills for overage.

Status (2026-10-07): **phase 1 is live in shadow mode** at https://portal.preeminentstore.com.
- Login gate verified signed-out with `scripts/verify-lock.mjs`. `workers.dev` and preview URLs are off (`scripts/check-routes.mjs`).
- 23 docs (~1.2 MB) migrated to D1.
- The 5-minute cron is running; `scripts/cron-state.mjs` shows the last tick.
- The PC portal is still the active host.

Status (2026-10-08): **the host lease (safety lock) is built and live** (section 1, "Host lease"). The PC portal holds it (`pc:BambooZ`). The cloud is in shadow mode and reports passive. The lease-aware Worker was deployed at 3:19 PM PT. Before the deploy, the local smoke test (417 checks) and the 13 lease unit tests passed. After it, the signed-out lock checks passed, and the first cloud cron tick (3:25 PM) logged "Passive: PC is in charge (pc:BambooZ)". The deploy rotated `SESSION_SECRET`, so everyone has to sign in again.

## 1. Decision

**A single Cloudflare Worker (`preeminent-portal`) on the Workers Free plan.** It uses:

- **D1** for the data (each former `data/*.json` file becomes one row group).
- The store's existing **KV** namespace, for orders, stock, and catalog.
- **one Cron Trigger** (every 5 minutes).
- **Workers Static Assets** for the pages.
- **a custom domain**, `portal.preeminentstore.com`.
- **The Worker's own Google sign-in** for login, allowing only `iv3nsun@gmail.com`.

Why this design and not the others:

| Option | Why not |
|---|---|
| Oracle Always Free VM / GCP e2-micro (the previous plan) | Card verification at signup. Breaks the no-card rule. |
| **Cloudflare Access** (Zero Trust Free) | Cloudflare's onboarding asks for payment details even on the Free plan (card or PayPal). Breaks the rule. The Worker still supports Access as an optional second mode (`ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`) if the owner ever chooses to add a payment method. |
| R2 for images/files | Enabling R2 asks for a payment method. Avoided. |
| Workers Paid ($5) | Not $0. The free plan's hard limits fail closed instead of billing. |
| Fly.io / Render free | Not $0 for new accounts, or sleeps and wipes disk. |

Everything used is on the free plan already attached to the account (wrangler is logged in as iv3nsun@gmail.com). Free-plan limits are hard caps: going over returns errors and never bills.

### Login and privacy

- Every request, pages included, passes the login check before anything is served (`run_worker_first`). The only exceptions are `/health` (returns only `{ok:true}`) and `/auth/*`.
- Sign-in uses Google OpenID (`openid email` scope only) with the OAuth client the PC portal already uses. It checks `email_verified` and the `OWNER_EMAILS` allowlist. The session is an HMAC-signed cookie (`HttpOnly; Secure; SameSite=Lax`, 7 days).
- It fails closed: with no login secrets configured, nobody gets in, owner included.
- Data-changing API calls must come from the portal's own pages (`Sec-Fetch-Site` / `Origin` check). Responses are `no-store`, `noindex`, and `X-Frame-Options: DENY`.
- `workers_dev = false` and `preview_urls = false`, so no unprotected `*.workers.dev` URL exists.
- Credentials never go to D1. These are Worker secrets: Google client id/secret, Google refresh token, `SESSION_SECRET`, and `AGENT_TOKEN`. The migration strips OAuth tokens and skips the PayPal/Resend/agent-token files and all LAN-only `zee-*` files.
- Customer details live only in D1, behind the login. Cron logs record order ids and totals, never addresses.

### Two portals never act at once

The cloud portal has a **mode** (D1 doc `portal-role`):

- **shadow** (the default) is read-only. Every 15 minutes it peeks at waiting `order:*` keys in KV without removing them. Every 30 minutes it mirrors Inventory26 and Sold 2026. It never deletes KV keys, writes the Sheet, pushes stock, or sends emails. "Mark paid", "Cancel", "Publish", and settings saves return HTTP 409.
- **active** runs the PC's publish cycle every 5 minutes: pull orders (delete from KV), expire unpaid Zelle/Venmo orders, write paid website sales to Sold 2026 and Inventory26, and push catalog/stock/manual-pay config to KV when anything changed. Turning active on requires typing "PC portal is stopped". Active mode also requires holding the host lease (below). Without it the cloud is **passive**: it stays read-only and the pages show "Passive: the PC portal is in charge".

### Host lease (only one host does the write jobs)

The rules live in one place, `server/portalLeaseCore.js`, used by both the PC (`server/portalLease.js`) and the Worker (`cloudflare-portal/src/lease.js`). Tests: `npm run test:lease` (13 unit tests, including a 24-hour simulation that checks both hosts never hold it at once) and the lease section of `scripts/smoke-test.mjs`.

- **KV `portal:active-host`** = `{ host: "pc"|"cloud", holder, preferred, claimedAt, expiresAt, updatedAt, by }`. `holder` is the instance id (`pc:<computer name>` or `cloud:preeminent-portal`). `holder: null` means the lease was handed to `host` but not claimed yet.
- **KV `portal:handover`** = `{ to: "cloud", requestedAt, by }`. It is written by the owner in the cloud portal and read by the PC every cycle.
- **TTL 20 minutes.** The holder renews only inside the last 11 minutes, so it writes about once every 10 minutes. One missed 5-minute cycle still leaves 5 minutes of lease.
- **Write jobs need a live lease:** order pull/delete, Zelle/Venmo expiry, Mark paid / Cancel, website-sale Sheet writes, catalog/stock/manual-pay pushes, and the PC's marketing drafts/insights sync. A passive PC still redeploys the site when its files change (the cloud never deploys the site), and still runs its Gmail/eBay Sheet intake, which the cloud doesn't do yet. Website sales are left out of that intake unless the PC holds the lease.
- **Who may claim:**
  - A **missing** lease is claimed only by the PC, the default host. The cloud never claims a missing lease on its own.
  - A lease **handed over** to a host is claimed only by that host.
  - An **expired** lease is claimed only by its `preferred` host (the last holder, or the host it was handed to). So if the PC is off, its lease expires, but the cloud does not take it without the owner.
  - The cloud claims nothing in **shadow** mode. Switching to shadow, or a shadow tick, hands back anything the cloud holds or was handed.
- **Stale reads:** KV can lag a write by about a minute (and caches "not found"). Each host trusts whichever is newer, its own last write or the KV read. The PC keeps that copy in memory; the cloud keeps it in D1 doc `lease-last-write`, which is strongly consistent.
- **If the lease read fails** (Cloudflare unreachable), the PC skips write jobs for that cycle.
- **Where to see it:** the PC sidebar shows a badge: "Active host" (green), "Passive — cloud is in charge", or "Passive — lease expired" (amber; clicking that one offers to take the lease back). `GET /api/portal-lease` returns the details. The cloud's Cloud Status page has a "Host lease" panel.
- **Audit:** cloud lease changes go to the audit log (action `lease handover`) and to Activity. The PC writes `data/portal-lease-audit.json` and shows a desktop toast when it hands over.
- **Who can change it:** owner only, with CSRF and same-origin checks like every other write. Viewer, staff, and manager get 403. The PC's take endpoint (`POST /api/portal-lease/take`) answers only to localhost requests with an `X-Portal-Owner: 1` header, so another website can't trigger it.

**Owner handover, PC → cloud (the PC keeps running and goes passive):**
1. Cloud Status → Mode → "Make active…" and type the confirmation. The cloud stays passive (read-only) because the PC still holds the lease.
2. Cloud Status → Host lease → "Request handover to cloud".
3. Within 5 minutes the PC's next cycle releases the lease. Its badge turns to "Passive — cloud is in charge" and a toast appears.
4. Within the next 5 minutes (plus up to 1 minute of KV lag) the cloud claims the lease. Its Mode card shows "active", and Activity logs "claimed the lease handed over by pc:…".
5. Optional: stop the PC portal. It would stay passive anyway.

**If the PC is already off:** make the cloud active, wait until the lease has expired (20 minutes after the PC's last renewal), then click "Force take…". Force take is refused while any other holder has a live lease. Only force-take when the PC portal is really stopped: a PC that wakes up within a minute of the take could still see its own expired lease.

**Back to the PC:** in the cloud, click "Hand back to PC…" or "Make shadow". The PC claims the lease on its next cycle. If the cloud is gone and the lease has expired, click the PC's amber badge, or run `Invoke-RestMethod -Method Post http://localhost:5173/api/portal-lease/take -Headers @{ 'X-Portal-Owner' = '1' }`.

### Never touching Inventory25 / Sold 2025

`src/google.js` has a hard allowlist (`Inventory26`, `Sold 2026`). Every read and write goes through `assertAllowedTab`, so the cloud cannot read or write any other tab. A website sale whose best match isn't an Inventory26 row with enough stock goes to review instead of being written.

## 2. Feature inventory and migration

Classes: **as-is** = works on Workers unchanged or nearly; **port** = rewrite fs → D1/KV, setInterval → cron, axios → fetch; **local** = stays on the PC or is dropped.

| Feature (PC module) | Depends on | Class | Status |
|---|---|---|---|
| Pull website orders from KV, every 5 min (`storePublish.pullWebOrders`) | wrangler CLI via `child_process`, `setInterval`, `web-orders.json` | port | **Built** (KV binding + cron, active mode only) |
| Zelle/Venmo mark paid / cancel / expire (`manualOrders.js`) | `store-settings.json`, `agent-token.json`, store `/api/manual/mark-paid` | port | **Built** (`AGENT_TOKEN` secret) |
| Push catalog + exact stock + manual-pay config to KV (`pushStoreData`) | wrangler `kv bulk put`, sha256 | port | **Built** (pushes the migrated catalog; skips when nothing changed) |
| Website sale → Sold 2026 + Inventory26 qty (`emailIntake.webSaleEvents` + `sheetLedger.applySaleLine`) | Google Sheets API, OAuth refresh token | port | **Built** (Inventory26 only, else review; 40-call budget per run) |
| Sheet read / health / rows (`sheetLedger.readTab`, `/api/sheet-sync/*`) | Sheets API | port | **Built** (mirror every 30 min, read-only) |
| Store settings view/edit (`storeCatalog.getStoreSettings`) | `store-settings.json` | port | **Built** (edit in active mode) |
| TCGplayer orders list (`/api/orders`) | `orders-db.json` | port | **Built** (read) |
| Catalog rebuild from the Sheet (`storeCatalog.buildStoreCatalog`, every 30 min) | Sheets, TCGplayer search/details (HTTP), product images written to `storefront/img`, Pages deploy | port | Phase 2. Images can't go to R2 (payment method); options are KV + Cache API, or keeping image URLs from TCGplayer's CDN. Also blocked by the Inventory25 rule (see risks). |
| Gmail order sync, TCGplayer sale emails → `orders-db` (`gmailOrders.js`) | Gmail API (fetch), refresh token | port | Phase 2 (parse a few messages per tick to stay under 10 ms CPU) |
| Distributor purchase emails / eBay sales → Sheet (`emailIntake.js`) | Gmail + Sheets | port | Phase 2 |
| Sheet-sync review UI (resolve / ignore events) | `sheet-sync-queue.json`, aliases | port | Phase 2 (data already migrated) |
| Marketing drafts pull / insights push (`storeMarketing.js`) | KV via wrangler | port | Phase 2 (small) |
| Desktop toasts (`desktopNotify.js`) | PowerShell | port | Activity log now; email alerts via the existing `email-alerts` worker / Resend in phase 2 |
| Gmail "Connect Google" re-consent | localhost redirect | local | Re-consent on the PC, then re-run `scripts/deploy.mjs` to refresh the secret |
| Tax prep, loan, sales-tax report, inventory sales matches, profit history | JSON files only | port | Phase 3 (pure JSON; data already migrated) |
| Inventory dashboard / workflow / price refresh (`inventoryAgent.js`) | JSON + HTTP scraping with delays | port | Phase 3 (spread the bulk refresh across cron ticks) |
| Treasure-hunt deal scan (passive scheduler) | HTTP scraping with sleeps | port / local | Phase 3 or stays local |
| Excel/CSV imports, year-sheet import (`xlsx`, local file paths) | `xlsx`, filesystem | local | Stays on the PC. The year import also involves Inventory25/Sold 2025. |
| TCGplayer seller-export import | CSV upload | local | Stays local (later: upload endpoint) |
| Promo shorts (`promoShorts.js`, `promoRender.js`) | `ffmpeg-static`, `@napi-rs/canvas`, `child_process` | local | Can't run on Workers |
| Website code deploy (`wrangler pages deploy`) | wrangler CLI, `storefront/` files | local | Stays on the PC / git (site code changes are rare) |
| Zee assistant (router, LAN scans, SmartThings, music, Audi, wake, voice) | LAN, PowerShell, local drives | local | Stays on the PC |
| 4-player card game (socket.io in `index.js`) | WebSockets in memory | local | Unrelated to the store; stays local |
| `hydrateUserEnvVars` (Windows user env) | PowerShell | replaced | Worker secrets |

### Data map (D1 docs)

Migrated by `scripts/migrate-data.mjs`: `orders-db`, `inventory-db`, `inventory-workflow-db`, `inventory-sales-ledger`, `inventory-profit-history`, `store-stock`, `store-settings`, `store-price-review`, `store-publish-state`, `web-orders`, `sheet-sync-settings`, `sheet-sync-queue`, `sheet-sync-aliases`, `orders-sync-settings`, `loan-db`, `tax-prep-db`, `treasure-hunt-db`, `tcgplayer-single-ids`, `tcgplayer-listings`, `marketing-drafts`, `marketing-insights-state`, `gmail-sync-settings` (sync bookkeeping only, no tokens), and `catalog` (from `storefront/catalog.json`). That's about 1.2 MB in total.

Cloud-only docs: `portal-role`, `cron-state`, `kv-pending-orders`, `sheet-snapshot`, `sheet-snapshot-meta`, and the `activity` table.

Never copied: `agent-token.json`, `paypal-credentials.json`, `resend-credentials.json`, OAuth tokens, `zee-*`, logs, imports, screenshots, promo videos.

## 3. Free-tier limits vs expected use

| Resource (Workers Free) | Limit | Expected portal use |
|---|---|---|
| Worker requests | 100,000/day | Cron 288/day plus a few hundred page/API hits |
| CPU per invocation | 10 ms | Shadow tick: a few ms. Active idle ticks skip the catalog via a timestamp check. Watch large docs (`sheet-sync-queue` is ~130 KB). |
| Outbound fetches per invocation | 50 | Google calls are capped at 40 per run; remaining sales continue next tick |
| Cron Triggers | 5 per account | 1 (the email-alerts worker uses none) |
| D1 rows read | 5,000,000/day (enforced since 2026-09-01) | ~5–20k/day |
| D1 rows written | 100,000/day | ~2–5k/day (docs are rewritten only on change; the Sheet mirror only when the Sheet changed) |
| D1 storage | 5 GB | ~2 MB |
| KV reads / writes / deletes / lists | 100k / 1k / 1k / 1k per day, shared with the store | See "KV budget" below. Today: about 1,200 reads, about 170 writes, about 670 lists. |
| Static assets | Free, unlimited requests | 3 files |
| Workers Logs | Free daily allowance | A few lines per tick |
| Google Sheets / Gmail API, OAuth | Free quotas (60 req/min/user) | ≤ 10 calls per 30 min in shadow; calls spaced 1.1 s apart |

### KV budget (per day, shared namespace)

Both hosts check every 5 minutes (288 cycles a day).

| Who / state | Reads | Writes | Deletes | Lists |
|---|---|---|---|---|
| PC holding the lease | 576 (lease + handover key) + 1 per order or draft | 144 lease renewals + 3 per stock change + 1 per insights change | 1 per order or draft | 576 (`order:` + `draft:`) |
| PC passive | 576 | 0 | 0 | 0 |
| Cloud shadow (or active but passive) | 288 lease + up to 25 per 15-minute peek + 1 per signed-in page load | 0 (one write only when handing back a lease) | 0 | 96 |
| Cloud holding the lease | 288 + 1 per order | 144 lease renewals + 3 per stock change | 1 per order | 288 |
| Store checkout (unchanged) | catalog/stock reads | 1 per order | 0 | 0 |
| A handover (once) | a few | 1 request + 1 release + 1 claim | 1 (request key) | 0 |

- **Today (PC holds the lease, cloud in shadow):** about 1,200 reads (limit 100,000), 144 + about 20 other writes (limit 1,000), and 672 lists (limit 1,000).
- **After cut-over (cloud holds the lease, PC stopped):** about 600 reads, about 160 writes, and 288 lists.
- The lease adds at most 144 writes and 864 reads a day. Lists are the tightest budget: they were already 672 before the lease, and the lease itself uses no lists.

## 4. Phased rollout

**Phase 0: built (done).** `cloudflare-portal/` exists, and the local test suite (`scripts/smoke-test.mjs`, 417 checks as of 2026-10-08; `--active` adds the cut-over path) passes. It covers:

- The login gate.
- Shadow refusals.
- The real read-only Sheet mirror.
- The full active cycle on local KV with test orders (pull, stock hold, mark paid, cancel, push, idle skip).

A dry run of a real paid order planned a "sell" on the right Inventory26 row with Sheet writes off.

**Phase 1: deploy in shadow mode.**
1. Owner adds the redirect URI (section 5, step 1).
2. Agent runs `node scripts/deploy.mjs`. This applies the D1 schema, deploys with secrets from a temp file, and checks that `/api/whoami` returns 401 and `/` redirects to login.
3. Agent runs `node scripts/migrate-data.mjs --remote`. It refuses to upload unless the live portal rejects unauthenticated requests.
4. Owner signs in once at https://portal.preeminentstore.com to confirm.
5. Run side by side for a few days. Compare the cloud's stock and orders with the PC's.

**Phase 2: port what cut-over needs.** Catalog rebuild (images without R2; the Inventory25 decision), Gmail order sync and purchase-email intake, the review UI, marketing drafts, and email alerts. ~~Make the PC portal lease-aware~~ **Built (2026-10-08):** both hosts use KV `portal:active-host`, and the PC stays passive while the cloud holds it (section 1, "Host lease").

**Phase 3: cut-over** (about 15 minutes, when no checkout is in progress):
1. Run `node scripts/migrate-data.mjs --remote` to copy the PC's latest state (it refuses once the cloud is active).
2. In the cloud portal, open Cloud Status → "Make active…" and type the confirmation. The cloud stays passive.
3. Click "Request handover to cloud". Wait for the PC badge to show "Passive — cloud is in charge" and for the cloud's Mode card to show "active" (up to about 11 minutes).
4. On the PC, disable the "PreEminent Portal" scheduled task and stop node on port 5173.
5. Watch Status → Activity for one cycle (orders pulled, stock pushed).

**Rollback:** set the cloud to shadow (Data tab), copy the cloud docs back (export endpoint, phase 2), and start `Start-Portal.bat`. The website, KV, and email worker are unaffected throughout.

**Phase 4: optional ports.** Tax prep, loan, inventory dashboard, treasure hunt. Promo shorts, imports, and Zee stay on the PC.

## 5. Owner steps (minimal)

1. Google Cloud Console → APIs & Services → Credentials → open the OAuth client the portal already uses for Gmail → **Authorized redirect URIs** → add `https://portal.preeminentstore.com/auth/callback` → Save. This only adds a URL. Nothing is removed and the PC portal is unaffected.
2. Tell the agent to deploy phase 1. Wrangler is already logged in; no further logins are needed.
3. Only if the deploy reports that it couldn't attach the domain (the wrangler login can read DNS but not edit it): Cloudflare dashboard → Workers & Pages → `preeminent-portal` → Settings → Domains & Routes → Add → Custom domain → `portal.preeminentstore.com`.

## 6. Risks

- **Inventory25 stock:** the cloud may never read Inventory25, but today's catalog counts in-stock rows there. Before the cloud rebuilds the catalog, either move the remaining stock rows into Inventory26 (owner decision) or freeze their last-known quantities.
- ~~PC not lease-aware yet~~ **Resolved by the host lease (2026-10-08).** Only the lease holder does write jobs. An active cloud without the lease is passive. Remaining edge cases:
  - Force take is meant for a stopped PC. A PC waking from sleep within a minute of a force take could act on its own expired lease for one cycle.
  - PC and Cloudflare clocks must agree to within a few minutes (expiry compares timestamps across hosts).
  - Sheet-sync review items the owner resolves by hand on the PC are not lease-gated.
- **10 ms CPU** on the free plan: big docs must stay small (trim `seenMessageIds`, archive old queue events). An over-limit invocation fails without billing.
- **Google refresh token:** if the OAuth consent screen is in "Testing", tokens expire after 7 days (on the PC too). Re-consent on the PC, then re-run the deploy script.
- **Login security** rests on the owner's Google account. Keep 2-Step Verification on. `scripts/deploy.mjs` generates a new `SESSION_SECRET` each time, which signs everyone out (harmless).
- **Local test copy:** `cloudflare-portal/.wrangler/` holds a local D1 copy of the data (same PC and OneDrive folder as `data/`, gitignored).

## 7. Commands (from `cloudflare-portal/`)

- Local: `node scripts/dev-vars.mjs`, then `node scripts/migrate-data.mjs`, then `node ../node_modules/wrangler/bin/wrangler.js dev --port 8788 --local --test-scheduled`, then `node scripts/smoke-test.mjs --active`. Re-run `migrate-data.mjs` afterwards to reset the local copy. `.dev.vars` turns Sheet writes off and has no `AGENT_TOKEN`.
- Deploy: `node scripts/deploy.mjs`, then `node scripts/migrate-data.mjs --remote`.
- Re-sync before cut-over: `node scripts/migrate-data.mjs --remote`.
