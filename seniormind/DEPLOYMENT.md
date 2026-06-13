# Deploy SeniorMind to Vercel

Your Supabase project is live. Vercel is connected to **sunderlandivan/Zaiven**, but **SeniorMind is not on GitHub yet** (`seniormind/` is still local-only). Vercel is currently deploying the TCG card game, not SeniorMind.

## Step 1 — Push SeniorMind to GitHub

From the repo root (`TCG`):

```cmd
git add seniormind
git commit -m "Add SeniorMind AI companion app"
git push origin main
```

## Step 2 — Configure Vercel root directory

In [Vercel → zaiven → Settings → General](https://vercel.com):

1. **Root Directory** → Edit → set to `seniormind`
2. Save → **Redeploy**

## Step 3 — Add environment variables

Vercel → **Settings → Environment Variables**. Add all of these for **Production**:

| Name | Value |
|------|--------|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://ytqzhhvfamrhstfbcpbr.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Your **publishable** key (`sb_publishable_...`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Your **secret** key (`sb_secret_...`) |
| `ANTHROPIC_API_KEY` | Your Claude API key |
| `ANTHROPIC_MODEL` | `claude-sonnet-4-6` |

Then **Redeploy**.

## Step 4 — Supabase ↔ GitHub (optional)

Supabase GitHub integration auto-deploys Edge Functions/migrations. For this MVP, the SQL Editor setup you already ran is enough. Future schema changes can go in `supabase/migrations/`.

## Local test after keys are in `.env.local`

```cmd
cd seniormind
node scripts/test-supabase.mjs
npm.cmd run dev
```

- Tablet: `/tablet`
- Dashboard: `/dashboard`

## Still missing for pilot

- [ ] API keys in `.env.local` (local dev)
- [ ] Same env vars in Vercel (production)
- [ ] Push `seniormind/` to GitHub + set Vercel root directory
- [ ] Anthropic billing credits (Evaluation plan needs credits for live Sunny chat)
- [ ] Staff login (Supabase Auth) — Phase 3 in PRODUCT_SPEC.md
- [ ] Monthly PDF report — Phase 4
