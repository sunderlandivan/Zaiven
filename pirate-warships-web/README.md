# Pirate Warships (Browser)

Browser-based 3D ship combat: WASD movement, mouse aim, projectile cannons, and auto-lead targeting.

## Run locally

```bash
cd pirate-warships-web
npm install
npm run dev
```

Open the URL shown (e.g. http://localhost:5173) in a browser.

## Controls

- **W / S** – Forward / Back
- **A / D** – Turn left / right
- **Mouse** – Aim (reticle follows cursor on the water plane)
- **Left click** – Fire cannons

## Build for production

```bash
npm run build
```

Output is in `dist/`. Serve with any static host (e.g. `npx serve dist`).

## Optional: multiplayer server

A small WebSocket server for create/join sessions can be added in `server/`; the current game is single-player with one AI ship.
