# Neon Playmat (4P) — High Card TCG Prototype

This is a tiny web-based 4-player trading card game prototype:

- 4 players join a room
- Each has a 40-card deck (numbers on face, solid black back)
- 3 rounds:
  - draw 7
  - choose 1
  - highest number wins the round (+1 point)
- After 3 rounds, highest points wins

## Run

```bash
npm install
npm run dev
```

Then open `http://localhost:5173`.

## How to play

- Enter your name
- Leave room blank to create one, or enter a room code to join friends
- Share the room code (top-right)
- The game auto-starts when 4 players have joined

## Notes

- This is an MVP for networking + UI + rules.
- Next obvious upgrades: better tie rules, animations, spectators, reconnect support, and custom decks.

## Deploy (Option B: public hosting)

This app runs as a single Node server (Express + Socket.IO) and serves `public/` plus the realtime game.

### Recommended: Render (single instance)

1. Create a Render account.
2. Create a new **Web Service**.
3. Connect your GitHub repo (you will need one) and set:
   - Build command: `npm install`
   - Start command: `npm run start`
   - Instance count: `1`
4. Render will set `PORT` automatically; the server listens on `process.env.PORT` when present.

After deployment, players can open the hosted URL and join using the same room code.

## Inventory Agent (new)

This project now also includes a local `TCG Inventory Agent` at:

- `http://localhost:5173/inventory`

Features:

- Import inventory from Excel (`.xlsx`) with duplicate merge handling
- Refresh live market signals from eBay listings/sold prices
- Compare fee-aware profitability for eBay vs TCGplayer
- Track orders (date, sale, fees, tracking number) for bookkeeping

### Quick start

1. Run `npm install`
2. Run `npm run dev`
3. Open `/inventory`
4. Import your spreadsheet using an absolute path, e.g. `C:\Users\TheIv\Downloads\Poke Inventory.xlsx`

## Zee — Jarvis-style HUD + voice

Open **`http://localhost:5173/zee`** (or `/zee.html`) for the modular sci-fi dashboard and OpenAI Realtime voice copilot.

### Features (v1)

- **Modules:** time + moon phase, stocks (NVDA / SPY + sparklines), news feeds (NVIDIA, Star Citizen, Steam, world/macro), Audi placeholder, Gmail inbox slice, local music player.
- **Voice:** WebRTC via server SDP relay to OpenAI (`POST /api/zee/voice/sdp`). Toggle with the **Voice** button. **Alt+Z** hides/shows the HUD; **Alt+M** toggles mic mute while connected.
- **HUD mode:** use `?hud=1` or the **HUD mode** button for a denser layout.

### Environment variables

| Variable | Purpose |
|----------|---------|
| `OPENAI_API_KEY` | Required for voice (Realtime `gpt-realtime` by default). |
| `OPENAI_REALTIME_MODEL` | Optional override (default `gpt-realtime`). |
| `OPENAI_REALTIME_VOICE` | Optional voice name (default `marin`). |
| `STOCKS_API_KEY` or `FINNHUB_API_KEY` | Finnhub token for `/api/zee/stocks`. |
| `NEWS_API_KEY` | NewsAPI.org key for `/api/zee/news`. |
| `ZEE_MUSIC_ROOT` | Music folder (default `C:\SSD\Media\Music`). |
| `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET` | Shared with inventory Gmail; Zee uses a **separate** OAuth callback. |
| `ZEE_GMAIL_REDIRECT_URI` | Optional; default `http://localhost:<PORT>/api/zee/gmail/auth/callback` — add this URI in Google Cloud Console for Zee. |
| `ZEE_GMAIL_TARGET_EMAIL` | Display label (default `iv3nsun@gmail.com`); tokens are always for the Google account you authorize. |

Token file (local, gitignored under `data/`): `data/zee-gmail-settings.json`.


