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


