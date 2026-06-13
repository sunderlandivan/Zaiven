# Supabase manual setup (2 minutes)

Your project is already created: **SeniorMind**  
URL: `https://ytqzhhvfamrhstfbcpbr.supabase.co`

## Step 1 — Copy API keys

1. In Supabase, open **SeniorMind** → **Project Settings** (gear icon) → **API**
2. Copy these two values into `seniormind/.env.local`:
   - **anon public** key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role** key → `SUPABASE_SERVICE_ROLE_KEY` (keep secret)

## Step 2 — Create database tables

1. In Supabase sidebar, open **SQL Editor**
2. Click **New query**
3. Open `seniormind/supabase/schema.sql` in Cursor, select all, copy
4. Paste into the SQL Editor and click **Run**

You should see tables: `facilities`, `residents`, `sessions`, `mood_logs`, `staff_alerts`, `staff`  
Plus seed data for Missy's Place (4 pilot residents).

## Step 3 — Restart the app

In Command Prompt or Cursor terminal:

```
cd seniormind
npm.cmd run dev
```

Open http://localhost:3000/dashboard — the blue "demo mode" banner should disappear.

---

### Windows PowerShell note

If `npm run` fails with "scripts is disabled", use:

```
npm.cmd run dev
```
