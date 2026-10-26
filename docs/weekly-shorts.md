# Weekly Shorts (YouTube Shorts + Instagram Reels)

Once a week the PC portal makes a new 12-second vertical Short (1080x1920) and posts it to YouTube and Instagram.
Everything is on the **Marketing** page, in the **Weekly Shorts** section: `http://localhost:5173/inventory-marketing.html#weekly-shorts`.

## What it makes

- **Style:** the same flashy template as the 30th Celebration ETB Short you approved on Oct 5, 2026 (`server/promoRender.js`): joke opener that pops in word by word, product slams in with screen shake and confetti, price stamp, funny sticker, store link, synthesized sound effects.
- **Product:** one **sealed** website item with a photo (Box, Booster Bundle, ETB, Pack, or Collection) — **never singles, custom decks, or accessories**. Needs qty ≥ 6 and price ≥ $15, rotating so the last 8 weekly items (and the last 3 manual promo Shorts) aren't repeated.
  - **Competitive only:** site price must be **at or below the TCGplayer market price** (from your latest TCGplayer export). If nothing qualifies, it skips making a Short rather than advertising overpriced stock.
  - Within competitive sealed stock it favors higher qty, new arrivals, recent best sellers, and margin.
- **Prices are never changed.** The Short shows the site's current price exactly. Before posting, the portal checks that the site price still matches the video. If the price changed, it refuses to post and asks you to make a new one.
- **Text:** a YouTube title with `#Shorts`, a description with `https://preeminentstore.com/p/<id>?ref=yt`, and an Instagram caption with `?ref=ig` and up to about 10 hashtags. You can edit all three before approving.
- **Privacy:** captions are generated only from catalog fields. A built-in check refuses anything that looks like a street address or ZIP code. Add your city (and anything else) under **Never mention**; that list stays on this PC. No location is ever attached to the upload.

## Schedule and safety switch

- Default: **Thursday 5:00 PM Pacific**. You can change the day, time, On/Off and platforms, then click **Save**.
- **Mode:** *Auto-post* (default) or *Ask me first*. **The first scheduled Short always waits for your Approve**, even in Auto-post. After you approve one, Auto-post is fully automatic.
- **Skip next week** skips the next scheduled run (click again to undo). **Make one now** renders one immediately; it always waits for approval.
- **Dry run** on a card checks the price and the connections (a read-only call to YouTube/Instagram) without posting anything.
- **No double posts:** it runs only while this PC holds the portal lease, at most once per scheduled week. If the PC was off at the scheduled time it catches up within 48 hours. Every step is saved first. If the server restarts mid-upload, that platform is marked "unknown" and is **never** retried automatically. Check the channel, then use **Post again** if needed.
- Results (links) show on each card and go to the audit log (`data/portal-lease-audit.json`, actions starting with `weekly short`). You get a desktop notification when a Short is ready, posted, or failed.

Files: videos and thumbnails are in `data/shorts/`; state and history are in `data/weekly-shorts.json`; the YouTube token is in `data/youtube-oauth.json` (separate from Gmail); the Instagram token is in `data/instagram-publish.json`. Never share these files.

## Connect YouTube (about 5 minutes, one time)

The store channel is **not** on iv3nsun@gmail.com, so you'll pick the store's Google account (or brand channel) on the consent screen. The YouTube token is stored separately and doesn't touch Gmail sync.

1. Open <https://console.cloud.google.com/> signed in as the account that owns the OAuth client, and select project **tcg-portal-gmail-sync-494918**.
2. **APIs & Services → Library**, search **YouTube Data API v3**, click **Enable**.
3. **APIs & Services → Credentials**, open the OAuth client **TCG Local OAuth**. Under **Authorized redirect URIs**, click **Add URI** and enter exactly:
   `http://localhost:5173/api/marketing/youtube/auth/callback`
   Then click **Save**. Changes can take a few minutes to apply.
4. **Google Auth Platform → Data access** (or *OAuth consent screen → Scopes*): add `.../auth/youtube.upload` and `.../auth/youtube.readonly`, then save. The app is already *In production*, so any Google account can consent.
5. On the PC, open the Marketing page, go to **Weekly Shorts**, and click **Connect YouTube**.
6. Google shows an account picker. Choose the **Google account that owns the store's YouTube channel**. If that account has several channels, choose the store's **brand channel** when asked.
7. If you see "Google hasn't verified this app", click **Advanced → Go to TCG Local OAuth** (it's your own app). Tick both YouTube permissions and click **Continue**.
8. You return to the Marketing page. It should say **connected to channel "<store channel name>"**. If it shows the wrong channel, or none, click **Disconnect** and connect again, choosing the other account/channel.
9. Click **Dry run** on the sample card. It should show `youtube: ready (<channel>)`.

**Public uploads and the API audit:** YouTube locks videos uploaded through the API to **Private** when the Google Cloud project hasn't passed YouTube's API compliance audit. If that happens, the card shows a note after posting. Either set the video to Public in YouTube Studio (one click), or request the free audit once at <https://support.google.com/youtube/contact/yt_api_form> ("YouTube API Services - Audit and Quota Extension"; describe it as "weekly product Shorts uploaded to our own channel"). After approval, uploads go out Public automatically.

Quota: one upload uses about 1,600 of the free 10,000 units a day. Weekly is well inside the limit.

### Monetization

The YouTube API **can't** turn monetization on for a single upload. Each upload inherits the channel's **Upload defaults** in YouTube Studio (**Settings → Upload defaults → Monetization**: On, plus ad settings). Monetization only works once the channel is in the **YouTube Partner Program** (Studio → **Earn**). So:

1. Make sure the store channel is in the YouTube Partner Program (Studio → Earn) and has accepted the Shorts monetization module.
2. Set **Upload defaults → Monetization → On** for the store channel.

The Shorts are built to be ad-friendly: original visuals, **generated sound effects only (no music, no third-party clips)**, uploaded as **not made for kids**, category **Gaming**, visibility **Public**. Don't add trending songs to these uploads; music from the YouTube app's library can restrict revenue on Shorts.

## Connect Instagram (about 15 minutes, one time, free)

Instagram only allows posting through the API for a **Business or Creator** account linked to a **Facebook Page**. The Meta app can stay in **Development mode** because you're its admin.

1. **Instagram app → Settings → Account type and tools → Switch to professional account**: choose **Business** (or Creator).
2. Link it to a Facebook Page you manage: **Instagram → Settings → Accounts Center → Accounts**, add your Facebook account. Then on the Facebook Page, go to **Settings → Linked accounts → Instagram → Connect**. Create a free Page for the store first if you don't have one.
3. Go to <https://developers.facebook.com/apps> and click **Create app**:
   - Use case: **Other** → type **Business** (or pick the "Manage messaging & content on Instagram" use case if offered).
   - Name it, e.g. `PreEminent Shorts`. You'll be its admin.
4. In the app dashboard, add the product **Instagram** → **API setup with Facebook login**. Leave the app in **Development** mode.
5. **App settings → Basic**: copy the **App ID** and **App secret**.
6. Open **Graph API Explorer**: <https://developers.facebook.com/tools/explorer/>.
   - Meta App: your new app. User or Page: **Get User Access Token**.
   - Add these permissions: `instagram_basic`, `instagram_content_publish`, `pages_show_list`, `pages_read_engagement`, `business_management`.
   - Click **Generate Access Token**, log in, and allow access to **your Page and the Instagram account**.
   - Copy the token.
7. On the Marketing page: **Weekly Shorts → Connect Instagram**. Paste the **App ID**, **App secret**, and the token, then click **Connect Instagram**.
   The portal swaps it for a long-lived Page token, which doesn't expire unless you change your Facebook password or remove the app. The App secret isn't saved.
8. It should say **Instagram: connected (@yourhandle)**. Click **Dry run** to confirm.

**How the video reaches Instagram (free):** by default the portal uses Instagram's *resumable upload*: the PC sends the file directly to Meta, so no public link is needed. A fallback (`instagramUpload: "portal-url"` in `data/weekly-shorts.json`) puts the video in Cloudflare KV for 2 hours (videos are about 6 MB, and KV allows 25 MB). Meta then fetches it from `https://portal.preeminentstore.com/media/short/<random>.mp4`, and the key is deleted right after publishing. The fallback needs the cloud portal redeployed once (`node cloudflare-portal/scripts/deploy.mjs`). The public store website (`storefront/`, `cloudflare/`) is not changed.

If the token stops working (for example after a password change), click **Disconnect** and repeat steps 6-7.

## Troubleshooting

- **"redirect_uri_mismatch"** when connecting YouTube: the URI in step 3 isn't saved exactly. Check for no trailing slash and `http`, not `https`.
- **YouTube says "connected" but there's no channel name:** you picked an account without a channel. Disconnect and pick the store account/brand channel.
- **Card says "The site price changed…":** reject it and click **Make one now**. Shorts never show an old price.
- **Nothing ran on Thursday:** the PC must be on and holding the portal lease (see the note under the connection buttons). It catches up within 48 hours.
