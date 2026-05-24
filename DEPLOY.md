# Deploy & Setup Guide

End-to-end walkthrough to take this repo from zero to a working `https://your-app.vercel.app` running on Supabase. Assumes you've never deployed it before. Time budget: ~30–45 min.

---

## 0. Upgrade Node first (one-time)

Your machine currently runs Node 16.15.0. Next.js 15 needs **Node 18.18+**, and Vercel's default runtime is **Node 20 LTS**, so match that locally.

**Option A — Node installer (simplest, Windows):**
1. Go to https://nodejs.org/en/download — download the **20.x LTS** Windows installer.
2. Run it. Accept defaults. It replaces the existing Node.
3. Open a fresh PowerShell window and check: `node -v` → should print `v20.x.x`.

**Option B — nvm-windows (lets you switch versions):**
1. Download from https://github.com/coreybutler/nvm-windows/releases (`nvm-setup.exe`).
2. Install. Open a new shell as admin: `nvm install 20.11.1` then `nvm use 20.11.1`.

---

## 1. Local install + smoke test

```powershell
# In the repo directory
npm install
copy .env.example .env.local
```

> If you'd previously installed without `pdf-parse` / `jszip` / `fast-xml-parser` / `dotenv`, re-run `npm install` — these are the deps Phase 3 + OPML added.

Leave `.env.local` for now — we'll fill it after Supabase is provisioned. You can run `npm run dev` immediately; you'll get a 401 on the auth callback until step 2 is done, which is expected.

---

## 2. Create a Supabase project (free tier is fine)

1. Sign in at https://supabase.com → **New project**.
2. Pick a name (`second-brain`), set a strong DB password, choose the region closest to you.
3. Wait ~2 min for provisioning.

### Enable the `pgvector` extension

Dashboard → **Database** → **Extensions** → search `vector` → toggle **on**.
(Or run the SQL in `drizzle/0000_enable_pgvector.sql` from the SQL Editor.)

### Grab your connection strings

Dashboard → **Project Settings** → **Database**:
- **Connection string → URI** (the *direct* one, port 5432) → use for `DATABASE_URL` during migrations.
- **Connection pooling → URI** (port 6543, "Transaction" mode) → use for `DATABASE_URL` in production. Pooled is required for serverless on Vercel.

Dashboard → **Project Settings** → **API**:
- **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
- **anon public key** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- **service_role key** → `SUPABASE_SERVICE_ROLE_KEY` (keep this server-only; never expose)

---

## 3. Push the schema + RLS

Fill in `.env.local` with the values from step 2 (use the **direct** `DATABASE_URL` for now), then:

```powershell
npm run db:push
```

Drizzle will diff your schema against the empty DB and create every table, index, and enum.

Now apply the row-level security policies and the auto-create-profile trigger. Easiest path: open Supabase **SQL Editor**, paste the contents of `supabase/policies.sql`, hit Run.

> If you ever wipe the DB, re-run `drizzle/0000_enable_pgvector.sql` first, then `npm run db:push`, then `supabase/policies.sql`.

After this step, switch `DATABASE_URL` in `.env.local` to the **pooled** connection string (port 6543) — that's what the runtime will use.

---

## 4. Configure auth (magic link)

Dashboard → **Authentication** → **URL Configuration**:
- **Site URL**: `http://localhost:3000` (for dev) — change to your Vercel URL after deploy.
- **Redirect URLs** (add both):
  - `http://localhost:3000/auth/callback`
  - `https://your-app.vercel.app/auth/callback` *(after deploy)* **

Dashboard → **Authentication** → **Providers** → **Email**:
- Make sure **Enable Email provider** is on.
- For free-tier convenience, **disable** "Confirm email" (lets you sign in with magic link on the first try without a separate confirmation step).

> The free tier sends ~3 emails/hour through Supabase's shared SMTP. For real use, plug in your own SMTP (Resend, Postmark, etc.) under **Auth → SMTP Settings**.

---

## 5. Smoke test locally

```powershell
npm run dev
```

Open http://localhost:3000 → you'll be redirected to `/login` → enter your email → click the magic link in your inbox → land on `/feeds`.

**Three quick things to verify:**

1. **Add a feed** — click `+` in the feeds sidebar header. Try `https://hnrss.org/frontpage` or any RSS URL. Articles should appear within a couple seconds.
2. **Import from Inoreader** — click the download icon (↓) in the feeds sidebar header. In Inoreader: **Preferences → Import / Export → Export OPML**. Drop the `.opml` file in.
3. **Upload a document** — click **Documents** in the global sidebar, then drop a PDF, `.md`, `.txt`, or `.epub` into the upload zone.

Click any article or document → the reader pane fetches and caches full text (article extraction via `@mozilla/readability`, documents via `pdf-parse` / JSZip-based ePub parser).

**Keyboard shortcuts** in the reader (Inoreader-style): `j` next · `k` previous · `m` mark read · `s` star · `v` open original · `esc` close.

---

## 6. Push to GitHub

```powershell
git add .
git commit -m "Phase 1 + Phase 2: scaffold, schema, RSS reader"
git remote add origin https://github.com/<you>/second-brain.git
git push -u origin main
```

---

## 7. Deploy to Vercel

1. Go to https://vercel.com/new → **Import** the GitHub repo.
2. **Framework Preset**: Next.js (auto-detected).
3. **Environment Variables** — add all of these (matching `.env.example`):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `DATABASE_URL` *(the **pooled** Supabase URL — port 6543)*
   - `CRON_SECRET` *(generate one: in PowerShell, `[guid]::NewGuid().ToString("N")`)*
   - `NEXT_PUBLIC_APP_URL` *(set to your final Vercel URL, e.g. `https://second-brain.vercel.app`)*
   - LLM keys can stay blank — Phase 4 needs them, Phase 2 does not.
4. Click **Deploy**.

Once deployed, go back to **Supabase → Authentication → URL Configuration** and:
- Update **Site URL** to your Vercel URL.
- Add `https://your-app.vercel.app/auth/callback` to **Redirect URLs**.

---

## 8. Verify Vercel Cron is running

Vercel reads `vercel.json` and registers the cron automatically. After the first deploy:

- **Project → Settings → Cron Jobs** should list `/api/cron/sync-feeds` running every 2 hours (`0 */2 * * *`).
- Click **Run now** to fire it once manually. The response shows `{ total, ok, failed, results: [...] }`.
- Vercel signs the call with `Authorization: Bearer $CRON_SECRET` — our route rejects any call without it (so external probes can't trigger syncs).

> Free Vercel plan limits cron to **once per day** per job. Either upgrade to Pro for hourly granularity, or change the schedule to `0 6 * * *` (daily at 6 AM UTC). Hobby plan is fine if you also click **Sync all** in the UI when you want fresher data.

---

## 9. PWA installability (mobile home screen)

The manifest is already wired (`public/manifest.webmanifest`). To get the install prompt and proper icons:

1. Generate two PNG icons (192×192, 512×512) — any logo will do. Drop them into `public/` as `icon-192.png` and `icon-512.png`.
2. Visit your deployed URL on a phone → Safari/Chrome → "Add to Home Screen". The app launches standalone (no browser chrome).

Phase 5 adds a service worker for offline reading.

---

## What works right now (Phase 2 + 3 surface)

**RSS reader**
- Magic-link sign-in → `/feeds` reader.
- Add / remove / sync individual feeds, sync all.
- **OPML import** from Inoreader, Feedly, NetNewsWire, Reeder (download icon in the feeds sidebar header).
- Three-column UI: feed nav + article list + reader pane.
- Optimistic mark-as-read (click an article and the list updates instantly; server catches up).
- Star / unstar; filter views: Unread / All / Starred.
- On-demand full-text extraction via Readability (`POST /api/articles/[id]/full-text`).
- Hourly-ish background sync via Vercel Cron (subject to your plan tier).

**Reading**
- Times New Roman serif by default; user-adjustable font / size / sepia theme via the type icon in the reader toolbar.
- Reading time estimate.
- Prev / next article navigation in the reader.
- **Keyboard shortcuts** (Inoreader-style): `j` / `↓` / `n` next · `k` / `↑` / `p` previous · `m` mark read/unread · `s` star · `v` / `o` open original · `esc` close reader.

**Documents**
- Drag-and-drop upload zone at `/documents` for PDF, Markdown, TXT, ePub.
- Recursive chunker (~1000 tokens, ~200 overlap) writes to `document_chunks` ready for Phase 4 embeddings.
- Reading pane uses the same font/size/theme controls.
- 20MB cap locally; **4.5MB cap on Vercel** (Vercel function payload limit — bigger files need a direct Supabase Storage upload, planned for Phase 4).

## What's still stubbed

- **Daily Brief** (Phase 4) — Anthropic streaming summary, prompt caching.
- **Semantic linking** (Phase 4) — needs embeddings provider; chunks already populated.
- **Auto-tagging + smart folder routing** (Phase 4) — LLM tool-calling against existing tags.
- **PWA polish + swipe gestures** (Phase 5).
- **Large file uploads via Storage signed URLs** (Phase 4/5).

## Troubleshooting

- **"DATABASE_URL is required"** during `npm run db:push` → you forgot to set `DATABASE_URL` in `.env.local`, OR you're using PowerShell and the shell didn't pick up the file. Try `npm run db:push` from a fresh terminal.
- **"vector type does not exist"** when pushing → you didn't enable the `pgvector` extension. Run `drizzle/0000_enable_pgvector.sql` in Supabase SQL Editor first.
- **Magic link 401s after click** → your `Site URL` or `Redirect URLs` in Supabase don't include the URL you actually clicked from. Add it, re-send the link.
- **Cron returns 401** → `CRON_SECRET` in Vercel env vars doesn't match what's set, or wasn't set at all. Add it under Project → Settings → Environment Variables → redeploy.
- **Feed adds but no articles appear** → check `feeds.last_error` in Supabase (Table Editor) — common causes are blocked user agents or non-XML responses.
- **Readability returns nothing for some sites** → some pages render server-side with JS only; Readability needs HTML. That's a known limitation; we fall back to the RSS excerpt.
