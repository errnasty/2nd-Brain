# Deploy & Setup Guide

End-to-end walkthrough to take this repo from zero to a working `https://your-app.up.railway.app` running on Supabase. Assumes you've never deployed it before. Time budget: ~30–45 min.

This guide uses **Railway** for hosting and **GitHub Actions** for cron (free, host-agnostic).

Railway runs the app as a long-lived Node server rather than as serverless functions, and the code now assumes that: request budgets, upload caps, model choices and batch sizes are all sized for a host that allows minutes per request rather than ~10 seconds. Deploying to a serverless host would still build, but several features would time out. If you move to another long-lived host (Render, Fly, a VPS), the cron piece stays the same.

---

## 0. Upgrade Node first (one-time)

Next.js 15 needs **Node 18.18+**. The repo pins **Node 20** in `.nvmrc`, which is what Railway builds with — match that locally.

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
   - **Direct connection** (port 5432) — use during `supabase db push`.
   - **Transaction pooler** (port 6543, PgBouncer) — use at runtime in production.
   - **Session pooler** — IPv4 fallback if your network doesn't speak IPv6.
5. The password is shown as `[YOUR-PASSWORD]` — replace it with the DB password you set. If you forgot it, **Project Settings → Database → Reset database password**. URL-encode special characters (`@` → `%40`, etc.).

Dashboard → **Project Settings → API**:
- **Project URL** → `NEXT_PUBLIC_SUPABASE_URL` (just the base URL, no `/rest/v1/` path)
- **anon public key** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- **service_role key** → `SUPABASE_SERVICE_ROLE_KEY` (keep this server-only)

---

## 3. Apply the database schema + RLS

The schema lives as versioned, idempotent migrations in `supabase/migrations/`
(0001–0024: tables, `updated_at` + sync triggers, tsvector search, FSRS,
gamification, user settings, rabbitholes, quizzes, ThinkTank, background AI
jobs, perf indexes). Apply them with the Supabase CLI:

```powershell
supabase db push
```

(or, in the Supabase **SQL Editor**, paste each `supabase/migrations/00NN_*.sql`
file in order and run them). This is the ONLY path that creates the sync
support / FSRS / tsvector triggers the app needs.

> ⚠️ **Do NOT use `npm run db:push` (`drizzle-kit push`) for a real deploy.** It
> generates a schema from `drizzle/`, which is the **desktop PGlite bundle
> source only** — it omits every `supabase/migrations/` trigger (sync support,
> FSRS, tsvector, gamification). A cloud DB built that way would silently lack
> sync support and break desktop sync. `drizzle/` is used solely to bundle the
> embedded desktop database, not as the deploy schema.

Now apply RLS policies and the auto-create-profile trigger. Open Supabase **SQL Editor**, paste the contents of `supabase/policies.sql`, hit Run.

> If you ever wipe the DB, re-run `supabase db push` (after enabling the
> `vector` extension), then re-run `supabase/policies.sql`.

> **Re-run `supabase/policies.sql` after every schema change that adds a table.** The file is idempotent (safe to run repeatedly). This matters because Supabase exposes every `public` table through its REST API using the anon key that ships in the browser bundle — a table without RLS enabled is readable and writable by anyone holding that key. If you deployed before July 2026, re-run it now: earlier versions only covered 9 of the 21 tables (directory items/tasks/flashcards, rabbithole nodes, gamification, and settings tables were unprotected).

Also apply the search-index migration (trigram indexes that keep global search fast as your library grows): paste `supabase/migrations/0008_search_and_index_perf.sql` into the SQL Editor and run it.

For production, you'll later switch `DATABASE_URL` (in Railway's service variables) to the **pooled** connection string — see step 7.

---

## 4. Configure auth (magic link)

Dashboard → **Authentication** → **URL Configuration**:
- **Site URL**: `http://localhost:3000` (for dev) — change to your Railway URL after deploy.
- **Redirect URLs** (add both):
  - `http://localhost:3000/auth/callback`
  - `https://your-app.up.railway.app/auth/callback` *(after deploy)*

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

## 7. Deploy to Railway

Railway runs the app as a **long-lived Node server** (`next start`) instead of
slicing it into serverless functions. That difference is the whole reason to
pick it: no 10-second function ceiling on the Readability extractor or the
Daily Brief stream, and no ~6 MB request-body cap on document uploads (Server
Actions are already configured for 20 MB in `next.config.ts`). The trade is
that it is not free — Hobby is $5/month of usage credit, and an always-on
service eats into that continuously.

`railway.json` in the repo root already pins the builder, build command, start
command, and healthcheck, so the dashboard needs almost no configuration.

### 1. Create the service

1. https://railway.com → **New Project → Deploy from GitHub repo** → authorize
   Railway on your GitHub account → pick this repo.
2. Railway reads `railway.json`, detects Node via Nixpacks, and honours
   `.nvmrc` (Node 20). The first build fails until env vars exist — expected,
   fix it in the next step and redeploy.

### 2. Environment variables

**Service → Variables → Raw Editor** and paste. Note this is the *service*
variable scope, not a shared project variable, unless you add more services.

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase base URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key |
| `DATABASE_URL` | The **pooled** Supabase URL (port 6543, Transaction mode) |
| `CRON_SECRET` | `[guid]::NewGuid().ToString("N")` in PowerShell |
| `NEXT_PUBLIC_APP_URL` | Your Railway domain (set after step 3) |
| `ANTHROPIC_API_KEY` | For the Daily Brief, Ask, and the rest of the AI surface |
| `EMBEDDINGS_PROVIDER` + its key | `voyage` + `VOYAGE_API_KEY`, or `openai` + `OPENAI_API_KEY` |

> ⚠️ **`NEXT_PUBLIC_*` vars are baked in at build time, not read at runtime.**
> Next.js inlines them into the client bundle, and `next.config.ts` also reads
> `NEXT_PUBLIC_SUPABASE_URL` to build the `connect-src` CSP directive. If you
> add or change one, you must **redeploy**, not just restart — otherwise the
> browser gets the old value and Supabase auth calls are blocked by CSP.

> `PORT` is injected by Railway and passed through to `next start` by the start
> command in `railway.json` (which also binds `0.0.0.0`, as Railway requires).
> You can leave it alone and let Railway auto-detect the port, **or** set
> `PORT=8080` explicitly and use the same number as the domain's target port —
> see step 3. A mismatch between the two is the usual cause of "Application
> failed to respond".

> Do **not** set `APP_RUNTIME`. That flag is for the Electron desktop build and
> switches auth to trusting the local session without verifying it.

> Leave `EMBEDDINGS_PROVIDER=local` alone in the cloud. It pulls a
> ~1.3 GB `@xenova/transformers` model into the container at runtime and will
> blow the memory budget; it exists for offline/desktop use.

Skip Railway's **Postgres** add-on. The schema depends on Supabase migrations,
RLS, `pgvector`, and Supabase Auth — the database stays where it is.

### 3. Get a domain

**Service → Settings → Networking → Generate Domain**. You get
`https://<service>.up.railway.app`.

If it asks which **port** your app listens on: the app listens on whatever
Railway's injected `PORT` says, falling back to 3000. The reliable way to stop
guessing is to set `PORT=8080` as a service variable and enter `8080` as the
target port, so both ends are pinned to the same number. To read the port of a
running deploy instead, check the logs — `next start` prints
`- Local: http://localhost:<port>` on boot — or run `railway variables`.

Then:

1. Set `NEXT_PUBLIC_APP_URL` to that URL and redeploy (see the build-time note
   above — a restart is not enough).
2. **Supabase → Authentication → URL Configuration**: set **Site URL** to the
   Railway URL and add `https://<service>.up.railway.app/auth/callback` to
   **Redirect URLs**.
3. Custom domain: same Networking panel → **Custom Domain** → add the CNAME it
   prints at your registrar. TLS is automatic.

### 4. Verify

```powershell
curl https://<service>.up.railway.app/api/health   # -> {"status":"ok","runtime":"cloud"}
```

That endpoint is also the healthcheck Railway itself polls, so a deploy that
goes green has already proven the server boots and routes. Then sign in with a
magic link and confirm you land on `/today`.

### 5. Cron

Unchanged — GitHub Actions (step 8) drives it. Set the `APP_URL` repo secret to
the Railway domain and `CRON_SECRET` to the same value you put in Railway.
Railway's own cron feature isn't used: it would need a second service, and
GitHub Actions keeps cron portable across hosts.

### CLI (optional)

```powershell
npm i -g @railway/cli
railway login
railway link          # attach this folder to the project/service
railway logs          # tail the running server
railway variables     # list env vars
railway redeploy      # re-run the last build, no code change
railway up            # deploy the working directory, bypassing GitHub
```

`railway up` deploys **local files, including uncommitted ones**. For normal
work let the GitHub integration deploy on push; reach for `up` only when you
need to test something you haven't committed.

### Railway gotchas

- **`Error: DATABASE_URL is not set` → `Failed to collect page data for /api/…`**
  — the build no longer needs database credentials (the Drizzle client is
  constructed on first query, not on import), so if you see this you are on an
  older commit. Pull, or set `DATABASE_URL` as a service variable. Either way
  the app still needs it at **runtime**. The route named in the error is
  arbitrary — whichever one Next collected first.
- **Build OOM / very slow builds** — the React Compiler plus `next build` is
  memory-hungry. If the build gets killed, raise the plan's memory or set
  `NODE_OPTIONS=--max-old-space-size=4096` as a service variable.
- **Healthcheck fails but logs look fine** — something is answering a redirect
  instead of 200. Check that `/api/health` is still in the middleware matcher
  exclusion list in `src/middleware.ts`.
- **App sleeps / cold starts** — Hobby services can scale to zero when idle.
  The 2-hourly GitHub Actions cron effectively keeps it warm anyway.
- **Costs creep up** — an always-on service bills for wall-clock time, not
  requests. Watch **Project → Usage** for the first week.

---

## 8. Set up cron via GitHub Actions

We use GitHub Actions for cron rather than a second Railway service because:
- It's free (well within the 2,000 free Actions minutes/month for public repos, more for private).
- Portable — same workflow runs no matter where you host the app.
- Easier to inspect / re-run via the GitHub UI.

The workflow lives at `.github/workflows/sync-feeds.yml` and runs every 2 hours.

**Setup:**

1. In GitHub → your repo → **Settings → Secrets and variables → Actions → New repository secret**:
   - `APP_URL` = `https://your-app.up.railway.app`
   - `CRON_SECRET` = the same value you set in Railway's service variables
2. Push at least one commit so the workflow file exists on the default branch.
3. Go to **Actions** tab → **Sync RSS feeds** → **Run workflow** → pick your branch → **Run workflow**. This fires it once manually so you can verify it works.
4. After the first successful manual run, GitHub will schedule the recurring run automatically.

**To inspect runs:** Actions tab → click any run → expand the "Trigger feed sync" step. You'll see HTTP 200 and the `{ total, ok, failed, results }` payload.

**Change the schedule:** edit the `cron:` line in `.github/workflows/sync-feeds.yml`. Some examples:
- `"0 */2 * * *"` — every 2 hours (current default)
- `"0 6,18 * * *"` — 6 AM and 6 PM UTC
- `"*/30 * * * *"` — every 30 minutes (works on Actions, but check the rate against your bandwidth budget)

### Trending (`.github/workflows/trending.yml`)

A second workflow scores how widely each story is being covered. This is what
makes the Feeds "Trending" sort and the Daily Brief's ranking mean anything —
without it `trend_score` stays 0 everywhere and both quietly fall back to
newest-first, which is the old behaviour and not an error.

It uses the **same two secrets** as the feed sync (`APP_URL`, `CRON_SECRET`), so
if that one is already set up there is nothing further to configure — just run
it once manually from the Actions tab (**Score trending stories → Run
workflow**) to confirm it returns HTTP 200.

It runs hourly, more often than the 2-hourly sync, because trending decays:
scores have to be recomputed as stories age even when no new articles arrived.
Each run is wall-clock budgeted and resumes from where the last one stopped, so
extra runs are cheap and never duplicate work. A `budgetExhausted: true` in the
response is normal on a large account — the next run continues from the oldest
unscored user.

It calls four public endpoints (GDELT, Google News RSS, Google Trends RSS and
the Hacker News search API). All are keyless and free; **no API keys or paid
accounts are required**. Each is fetched independently and fails soft, so an
endpoint being down or rate-limiting degrades the ranking rather than breaking
the run — with all four unreachable, trending still works off cross-feed
corroboration alone.

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
- 20MB cap everywhere. Railway imposes no request-body size limit of its own (only a 5-minute ceiling on how long the upload may take), so the web app allows the same 20MB the desktop app does.

## What's still stubbed

- **Daily Brief** (Phase 4) — Anthropic streaming summary with prompt caching.
- **Semantic linking** (Phase 4) — embeddings provider + cosine-similarity sidebar.
- **Auto-tagging + smart folder routing** (Phase 4) — LLM tool calling.
- **PWA service worker + swipe gestures** (Phase 5).
- **Large file uploads via Storage signed URLs** (Phase 4/5).

## Troubleshooting

- **`DATABASE_URL is required`** during `supabase db push` → the db:push path is gone (see step 3); use `supabase db push` from the generated migrations instead. If you still see this, check `.env.local` exists in the repo root and the var is filled in. Restart your shell so `dotenv` re-reads it.
- **`Cannot find module 'dotenv/config'`** → run `npm install dotenv`.
- **`vector type does not exist`** when pushing → enable the `pgvector` extension in Supabase first.
- **`database "postgre" does not exist`** → typo: should be `/postgres` (with an `s`) at the end of the DATABASE_URL.
- **`Invalid path specified in request URL`** during magic-link sign-in → `NEXT_PUBLIC_SUPABASE_URL` has `/rest/v1/` appended. Remove it.
- **Magic-link 401** after click → your `Site URL` / `Redirect URLs` in Supabase don't include the URL you clicked from. Add it.
- **GitHub Actions cron returns 401** → `CRON_SECRET` mismatch between Railway's service variables and the GitHub Actions secret.
- **GitHub Actions cron doesn't fire on schedule** → GitHub's scheduled workflows only run if the repo has had a push in the last 60 days. Push a commit (or run it manually once a month) to keep it alive.
- **Feed adds but no articles appear** → check `feeds.last_error` in Supabase (Table Editor) — common causes: blocked user agents, non-XML responses.
- **Readability returns nothing for some sites** → some pages need JS to render; Readability needs static HTML. We fall back to the RSS excerpt.
- **PDF upload fails over 20MB** → that is our own cap (`src/lib/upload-limits.ts`), enforced client-side so it fails with a clear message rather than a 413.
- **`Server Action '<hash>' was not found on the server`** (desktop) → the bundled standalone server's Server Action manifest is stale relative to the client. **Fix: rebuild the desktop app** (`npm run desktop:build`) so the client and the bundled `.next/standalone` server come from one `next build`. A partial build or an electron-builder package from an older `.next/standalone` causes this; the build now fails loudly if the two manifests disagree.
