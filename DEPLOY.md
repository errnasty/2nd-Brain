# Deploy & Setup Guide

End-to-end walkthrough to take this repo from zero to a working `https://your-app.netlify.app` running on Supabase. Assumes you've never deployed it before. Time budget: ~30–45 min.

This guide uses **Netlify** for hosting and **GitHub Actions** for cron (free, host-agnostic). If you want to move to a different platform later (Cloudflare Pages, Render, Railway, your own VPS), the cron piece stays the same.

---

## 0. Upgrade Node first (one-time)

Your machine currently runs Node 16.15.0. Next.js 15 needs **Node 18.18+**, and Netlify's default runtime is **Node 20**, so match that locally.

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

> If you'd previously installed without `pdf-parse` / `jszip` / `fast-xml-parser` / `dotenv`, re-run `npm install` — these are deps Phase 3 + OPML added.

---

## 2. Create a Supabase project (free tier is fine)

1. Sign in at https://supabase.com → **New project**.
2. Pick a name (`second-brain`), set a strong DB password, choose the region closest to you.
3. Wait ~2 min for provisioning.

### Enable the `pgvector` extension

Dashboard → **Database** → **Extensions** → search `vector` → toggle **on**.
(Or run the SQL in `drizzle/0000_enable_pgvector.sql` from the SQL Editor.)

### Grab your connection strings

The Supabase UI moved this — easiest path now:

1. Open your project.
2. Top of the page → click **Connect** (top center).
3. In the panel, switch the format tab to **URI**.
4. You'll see three connection types:
   - **Direct connection** (port 5432) — use during `npm run db:push`.
   - **Transaction pooler** (port 6543, PgBouncer) — use at runtime in production.
   - **Session pooler** — IPv4 fallback if your network doesn't speak IPv6.
5. The password is shown as `[YOUR-PASSWORD]` — replace it with the DB password you set. If you forgot it, **Project Settings → Database → Reset database password**. URL-encode special characters (`@` → `%40`, etc.).

Dashboard → **Project Settings → API**:
- **Project URL** → `NEXT_PUBLIC_SUPABASE_URL` (just the base URL, no `/rest/v1/` path)
- **anon public key** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- **service_role key** → `SUPABASE_SERVICE_ROLE_KEY` (keep this server-only)

---

## 3. Push the schema + RLS

Fill in `.env.local` with the values from step 2 (use the **direct** `DATABASE_URL`), then:

```powershell
npm run db:push
```

Drizzle creates every table, index, and enum.

Now apply RLS policies and the auto-create-profile trigger. Open Supabase **SQL Editor**, paste the contents of `supabase/policies.sql`, hit Run.

> If you ever wipe the DB, re-run `drizzle/0000_enable_pgvector.sql` first, then `npm run db:push`, then `supabase/policies.sql`.

For production, you'll later switch `DATABASE_URL` (in Netlify env vars) to the **pooled** connection string — see step 7.

---

## 4. Configure auth (magic link)

Dashboard → **Authentication** → **URL Configuration**:
- **Site URL**: `http://localhost:3000` (for dev) — change to your Netlify URL after deploy.
- **Redirect URLs** (add both):
  - `http://localhost:3000/auth/callback`
  - `https://your-app.netlify.app/auth/callback` *(after deploy)*

Dashboard → **Authentication → Providers → Email**:
- Make sure **Enable Email provider** is on.
- For free-tier convenience, **disable** "Confirm email" (lets you sign in with magic link on first try).

> Free Supabase tier: ~3 emails/hour via shared SMTP. For real use, plug in your own SMTP (Resend, Postmark) under **Auth → SMTP Settings**.

---

## 5. Smoke test locally

```powershell
npm run dev
```

Open http://localhost:3000 → redirected to `/login` → enter your email → click magic link → land on `/feeds`.

**Three quick things to verify:**

1. **Add a feed** — click `+` in the feeds sidebar. Try `https://hnrss.org/frontpage`.
2. **Import from Inoreader** — click the download icon (↓). In Inoreader: **Preferences → Import / Export → Export OPML**, drop the `.opml` file.
3. **Upload a document** — click **Documents** in the global sidebar, drop a PDF / `.md` / `.txt` / `.epub`.
4. **Drag a feed into a folder** — drag any feed row onto a folder header. Drag back to "Uncategorized" to remove. Folders collapse with the chevron.

**Keyboard shortcuts** in the reader: `j` next · `k` previous · `m` mark read · `s` star · `v` open original · `esc` close.

---

## 6. Push to GitHub

```powershell
git add .
git commit -m "Phase 1 + 2 + 3: scaffold, RSS, OPML, documents"
git remote add origin https://github.com/<you>/second-brain.git
git push -u origin main
```

---

## 7. Deploy to Netlify

1. Go to https://app.netlify.com/ → **Add new site → Import an existing project** → connect GitHub → pick your repo.
2. Netlify detects Next.js from `netlify.toml`. Defaults are fine.
3. **Site configuration → Environment variables** — add:

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase base URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key |
| `DATABASE_URL` | The **pooled** Supabase URL (port 6543, Transaction mode) |
| `CRON_SECRET` | Generate one: in PowerShell, `[guid]::NewGuid().ToString("N")` |
| `NEXT_PUBLIC_APP_URL` | `https://your-app.netlify.app` (set after first deploy) |

LLM keys (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`) can stay blank for Phases 2 + 3 — Phase 4 needs them.

4. **Deploy site**. First build takes ~3 min.

5. Back in **Supabase → Authentication → URL Configuration**:
   - Update **Site URL** to your Netlify URL.
   - Add `https://your-app.netlify.app/auth/callback` to **Redirect URLs**.

6. (Optional) Custom domain: Netlify → **Domain settings** → **Add a domain you already own**. Free wildcard HTTPS via Let's Encrypt.

### Netlify free tier limits (for context)

- **100 GB bandwidth / month** — plenty for personal use.
- **125k function invocations / month** — about 4k/day.
- **100 hours total function runtime / month**.
- **300 build minutes / month** — ~30 deploys/day at 1 min each.

This is much more generous than Vercel Hobby's cron-only restrictions.

---

## 8. Set up cron via GitHub Actions

We use GitHub Actions for cron rather than Netlify Scheduled Functions because:
- It's free (well within the 2,000 free Actions minutes/month for public repos, more for private).
- Portable — same workflow runs no matter where you host the app.
- Easier to inspect / re-run via the GitHub UI.

The workflow lives at `.github/workflows/sync-feeds.yml` and runs every 2 hours.

**Setup:**

1. In GitHub → your repo → **Settings → Secrets and variables → Actions → New repository secret**:
   - `APP_URL` = `https://your-app.netlify.app`
   - `CRON_SECRET` = the same value you set in Netlify env vars
2. Push at least one commit so the workflow file exists on the default branch.
3. Go to **Actions** tab → **Sync RSS feeds** → **Run workflow** → pick your branch → **Run workflow**. This fires it once manually so you can verify it works.
4. After the first successful manual run, GitHub will schedule the recurring run automatically.

**To inspect runs:** Actions tab → click any run → expand the "Trigger feed sync" step. You'll see HTTP 200 and the `{ total, ok, failed, results }` payload.

**Change the schedule:** edit the `cron:` line in `.github/workflows/sync-feeds.yml`. Some examples:
- `"0 */2 * * *"` — every 2 hours (current default)
- `"0 6,18 * * *"` — 6 AM and 6 PM UTC
- `"*/30 * * * *"` — every 30 minutes (works on Actions, but check the rate against your bandwidth budget)

---

## 9. PWA installability (mobile home screen)

The manifest is wired at `public/manifest.webmanifest`. To get the install prompt with proper icons:

1. Generate two PNG icons (192×192, 512×512). Drop them in `public/` as `icon-192.png` and `icon-512.png`.
2. Visit your deployed URL on a phone → Safari/Chrome → "Add to Home Screen". App launches standalone.

Phase 5 adds a service worker for offline reading.

---

## What works right now (Phase 2 + 3 surface)

**RSS reader**
- Magic-link sign-in → `/feeds` reader.
- Add / remove / sync individual feeds, sync all.
- **OPML import** from Inoreader, Feedly, NetNewsWire, Reeder (↓ icon in the feeds sidebar header).
- **Drag-and-drop feeds into folders**; drag to "Uncategorized" to remove from folder.
- **Collapsible folders** (state persisted to localStorage).
- Three-column UI: feed nav + article list + reader pane.
- Optimistic mark-as-read with client-side article fetching (no full RSC refetch on article click).
- Star / unstar; filter views: Unread / All / Starred.
- On-demand Readability extraction caches `full_text` in DB.
- 2-hourly background sync via GitHub Actions cron.

**Reading**
- **Times New Roman** site-wide for that premium feel.
- Reader-specific font / size / sepia theme picker (persists in localStorage).
- Reading time estimate, prev / next nav.
- **Keyboard shortcuts** (Inoreader-style): `j` / `↓` / `n` next · `k` / `↑` / `p` previous · `m` mark read/unread · `s` star · `v` / `o` open original · `esc` close reader.

**Documents**
- Drag-and-drop upload at `/documents` for PDF, Markdown, TXT, ePub.
- Recursive chunker (~1000 tokens, ~200 overlap) writes to `document_chunks` for Phase 4 embeddings.
- 20MB local cap; **~6MB cap on Netlify functions** by default. For bigger files, switch to a direct Supabase Storage upload (planned for Phase 4).

## What's still stubbed

- **Daily Brief** (Phase 4) — Anthropic streaming summary with prompt caching.
- **Semantic linking** (Phase 4) — embeddings provider + cosine-similarity sidebar.
- **Auto-tagging + smart folder routing** (Phase 4) — LLM tool calling.
- **PWA service worker + swipe gestures** (Phase 5).
- **Large file uploads via Storage signed URLs** (Phase 4/5).

## Troubleshooting

- **`DATABASE_URL is required`** during `npm run db:push` → check `.env.local` exists in the repo root and the var is filled in. Restart your shell so `dotenv` re-reads it.
- **`Cannot find module 'dotenv/config'`** → run `npm install dotenv`.
- **`vector type does not exist`** when pushing → enable the `pgvector` extension in Supabase first.
- **`database "postgre" does not exist`** → typo: should be `/postgres` (with an `s`) at the end of the DATABASE_URL.
- **`Invalid path specified in request URL`** during magic-link sign-in → `NEXT_PUBLIC_SUPABASE_URL` has `/rest/v1/` appended. Remove it.
- **Magic-link 401** after click → your `Site URL` / `Redirect URLs` in Supabase don't include the URL you clicked from. Add it.
- **GitHub Actions cron returns 401** → `CRON_SECRET` mismatch between Netlify env vars and the GitHub Actions secret.
- **GitHub Actions cron doesn't fire on schedule** → GitHub's scheduled workflows only run if the repo has had a push in the last 60 days. Push a commit (or run it manually once a month) to keep it alive.
- **Feed adds but no articles appear** → check `feeds.last_error` in Supabase (Table Editor) — common causes: blocked user agents, non-XML responses.
- **Readability returns nothing for some sites** → some pages need JS to render; Readability needs static HTML. We fall back to the RSS excerpt.
- **PDF upload "Internal Server Error" on Netlify** → file is too big for the function payload limit. Local dev allows up to 20MB.
