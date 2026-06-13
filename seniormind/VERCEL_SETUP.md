# Vercel setup for SeniorMind (zaiven project)

Your Vercel project **zaiven** is linked to `sunderlandivan/Zaiven`. Follow these steps in order.

---

## Step A — Push SeniorMind to GitHub (required before deploy works)

SeniorMind is still local-only. In **Command Prompt** (not PowerShell, if npm is blocked):

```cmd
cd C:\Users\TheIv\OneDrive\Documents\Cursor\TCG
git add seniormind
git commit -m "Add SeniorMind AI companion app"
git push origin main
```

---

## Step B — Set Root Directory to `seniormind`

1. Open [vercel.com](https://vercel.com) → click project **zaiven**
2. Top menu → **Settings**
3. Left sidebar → **General**
4. Scroll to **Root Directory** → click **Edit**
5. Enter: `seniormind`
6. Click **Save**

This tells Vercel to build the Next.js app inside the `seniormind` folder, not the TCG card game at repo root.

---

## Step C — Add Environment Variables

1. Still in **zaiven** → **Settings**
2. Left sidebar → **Environment Variables**
3. Add each row below. For **Environment**, check **Production**, **Preview**, and **Development** (or at least Production).

| Key | Value |
|-----|--------|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://ytqzhhvfamrhstfbcpbr.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | *(copy from `seniormind/.env.local` — publishable key)* |
| `SUPABASE_SERVICE_ROLE_KEY` | *(copy from `seniormind/.env.local` — secret key)* |
| `ANTHROPIC_API_KEY` | *(copy from `seniormind/.env.local`)* |
| `ANTHROPIC_MODEL` | `claude-sonnet-4-6` |

**How to add each one:**
- Click **Add New** (or **Add Environment Variable**)
- **Key** = name from table
- **Value** = paste value (no quotes)
- **Environments** = select all three checkboxes
- Click **Save**

Repeat for all 5 variables.

---

## Step D — Redeploy

1. Top menu → **Deployments**
2. On the latest deployment → **⋯** menu → **Redeploy**
3. Confirm **Redeploy**

Or push a new commit after Step A — Vercel will auto-deploy.

---

## Step E — Verify

After deploy succeeds, open:

- `https://zaiven.vercel.app` — SeniorMind home (not the card game)
- `https://zaiven.vercel.app/tablet` — tablet UI
- `https://zaiven.vercel.app/dashboard` — staff dashboard (live Supabase data)

If you still see the card game, Root Directory is not set to `seniormind` yet.

---

## Optional — Custom domain

Settings → **Domains** → add something like `seniormind.vercel.app` or your own domain later.

---

## Quick checklist

- [ ] Pushed `seniormind/` to GitHub
- [ ] Root Directory = `seniormind`
- [ ] 5 environment variables added
- [ ] Redeployed
- [ ] `/dashboard` shows Missy's Place residents (not demo banner)
