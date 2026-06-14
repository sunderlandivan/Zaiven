# SeniorMind

AI companion tablet and staff dashboard for skilled nursing facilities (SNFs).

## Quick Start (local dev optional)

Production runs at **https://zaiven.vercel.app**. For local development:

```bash
cd seniormind
npm install
cp .env.example .env.local   # add Supabase + Anthropic keys
npm.cmd run dev
```

Open [http://localhost:3000](http://localhost:3000)

- **Tablet App:** [/tablet](http://localhost:3000/tablet) — resident-facing UI
- **Staff Dashboard:** [/dashboard](http://localhost:3000/dashboard) — nurse portal

## Production (tablets)

Point each tablet browser to **https://zaiven.vercel.app/tablet** and pin to the home screen as a PWA. Per-bed URLs can include a resident ID:

`https://zaiven.vercel.app/tablet?resident=<resident-uuid>`

## Setup Supabase (one browser login)

From the `seniormind` folder, run **one** of these (Windows PowerShell often blocks `npm` — use the alternatives):

```bash
node scripts/setup-supabase.mjs
```

```bash
npm.cmd run supabase:setup
```

Or open **Command Prompt** (not PowerShell) and run `npm run supabase:setup`.

This will:
1. Open your browser for a **one-time Supabase login**
2. Create a free cloud project named `seniormind`
3. Apply the database schema (tables + Missy's Place seed data)
4. Write Supabase keys into `.env.local` automatically

Then restart the dev server: `npm run dev`

### Manual alternative

1. Create a project at [supabase.com](https://supabase.com)
2. SQL Editor → paste and run `supabase/schema.sql`
3. Project Settings → API → copy URL, anon key, and service role key to `.env.local`

## Setup Claude

1. Get an API key from [console.anthropic.com](https://console.anthropic.com)
2. Add `ANTHROPIC_API_KEY` to `.env.local`
3. The Evaluation (free) plan requires adding credits under **Plans & Billing** before live API calls work. Until then, the app falls back to demo Sunny responses automatically.

## Deploy (Vercel)

1. Push to GitHub
2. Import project in Vercel, set root directory to `seniormind`
3. Add environment variables from `.env.example`
4. Deploy

## Tablet PWA (Amazon Fire HD)

1. Open `/tablet` in Silk/Chrome browser
2. Menu → "Add to Home Screen"
3. Pin for kiosk-style bedside use

## Project Structure

See `PRODUCT_SPEC.md` for full product requirements, DB schema, and phased roadmap.

## Pilot

- **Facility:** Senior Living Homes
- **Beds:** 10 tablets
- **Trial:** 30 days free
- **Goal:** Engagement + mood data to prove staff time savings
