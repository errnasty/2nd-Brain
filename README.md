# Second Brain

A self-hosted reading, research, and study system. It pulls your RSS feeds and
uploaded documents into one library, embeds everything for semantic search,
writes you a daily brief, and turns what you read into tasks, flashcards, and
spaced-repetition reviews.

Built on **Next.js 15** (App Router, React 19 + React Compiler), **Supabase**
(Postgres + `pgvector` + Auth), **Drizzle ORM**, **Tailwind + shadcn/ui**, and
the **Vercel AI SDK** with Anthropic / OpenRouter providers. Ships as a web app
(installable PWA) and as an **Electron desktop app** with an embedded local
database and two-way sync.

**👉 Deploying? [DEPLOY.md](DEPLOY.md) is the step-by-step walkthrough** —
Supabase setup, then [Railway](DEPLOY.md#7-deploy-to-railway), plus GitHub
Actions cron.

**Desktop build:** [DESKTOP.md](DESKTOP.md).

---

## What it does

**Read**
- RSS/Atom ingestion with folder organisation, drag-and-drop, OPML import.
- Three-column reader: feed nav, virtualised article list, reader pane.
  Optimistic mark-as-read, star, unread/all/starred filters.
- On-demand full-text extraction via `@mozilla/readability`, cached to the DB.
- **Trending** — cross-feed corroboration scored against GDELT, Google News,
  Google Trends, and the HN search API, so the list can rank by what's actually
  being covered rather than by recency.
- Reader translation through a real MT engine (Lingva / MyMemory), not an LLM.
- Keyboard shortcuts throughout: `j`/`k` navigate, `m` mark, `s` star, `v` open
  original, `esc` close.

**Collect**
- Drag-and-drop upload for PDF, ePub, DOCX/PPTX/XLSX, Markdown, and TXT.
- Recursive ~1000-token chunker with overlap, written to `document_chunks`.
- **Directory** — one unified library view over articles and documents, with
  grouping, filtering, and tags.
- Auto-tagging and smart folder routing via structured LLM output.

**Think**
- **Today** — a daily brief that ranks what matters, remembers which stories it
  already told you about, and tracks reading progress and XP through the day.
- **Ask** — chat over your library with threads and persistent memory, plus
  document-scoped Q&A.
- **Related Knowledge** — cosine-similarity sidebar across articles and docs.
- **Map** — a graph view of how your library connects.
- **Rabbithole** — guided depth-first exploration from any starting point.
- **ThinkTank** — multi-angle exploration of a question.
- **Weekly synthesis**, **gaps** analysis, and **connections** surfacing.

**Study**
- **Study hub** (`/study`) — Overview, Tasks, Review, and Calendar in one place.
- Flashcards scheduled with **FSRS**.
- Curriculum and study-plan generation from your own material.
- Quizzes, and an XP / skills / levels layer over the whole app.

**Elsewhere**
- **MCP server** at `/api/mcp` — point Claude Desktop or mobile at your brain.
- Export, offline reading via service worker, invite-only signup, and a daily
  per-user AI token budget for multi-user self-hosting.

---

## Prerequisites

- **Node.js 20 LTS** — pinned in `.nvmrc`, and what the hosts build with.
  Minimum is 18.18 (Next 15).
- A **Supabase** project with the `vector` extension enabled.
- An **Anthropic** API key (or an OpenRouter key — see below).
- An embeddings provider: **Voyage** (default), **OpenAI**, or **local**
  (`@xenova/transformers`, offline, no key).

> Anthropic ships no embeddings API. The default is Voyage `voyage-3-large`
> (1024 dims, matching the `pgvector` column). Switching providers requires
> re-embedding the whole library — vectors from different models are not
> comparable.

> `OPENROUTER_API_KEY` redirects background AI work through OpenRouter. Web
> search stays Anthropic-only.

## Quick start

```powershell
# 1. Install
npm install
copy .env.example .env.local     # then fill it in

# 2. Apply the schema (needs the Supabase CLI, and `vector` enabled first)
supabase db push

# 3. Apply RLS + the auto-create-profile trigger
#    Supabase SQL Editor -> paste supabase/policies.sql -> Run

# 4. Run
npm run dev
```

> ⚠️ **`npm run db:push` is not a deploy path.** `drizzle-kit push` generates a
> schema from `drizzle/`, which exists solely to bundle the **desktop** PGlite
> database. It omits every trigger in `supabase/migrations/` — sync support,
> FSRS, tsvector search, gamification. A cloud DB built that way silently
> breaks desktop sync. Use `supabase db push`.

> **Re-run `supabase/policies.sql` after any change that adds a table.** It is
> idempotent. Supabase exposes every `public` table over REST using the anon key
> that ships in the browser bundle, so a table without RLS is world-readable.

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Production build (`postbuild` stamps the service worker build id) |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint, zero-warnings gate |
| `npm test` | Vitest unit tests (via `scripts/vitest.mjs`) |
| `npm run test:e2e` | Playwright smoke suite |
| `npm run desktop:dev` / `desktop:build` | Electron app |
| `npm run db:studio` | Drizzle Studio |

## Layout

```
src/
  app/
    (app)/            # Authenticated routes: today, feeds, directory, documents,
                      # ask, map, rabbithole, thinktank, study, search, settings…
    api/              # Route handlers: brief, ask, embeddings, cron, mcp, sync,
                      # export, jobs, curriculum, weekly-synthesis, health…
    auth/callback/    # Magic-link / OAuth exchange
    login/ signup/    # Public auth pages
  components/         # Feature-scoped UI + shadcn primitives in ui/
  lib/
    ai/ ai-jobs/      # Providers, prompts, background job queue
    db/               # Drizzle schema + client
    embeddings/       # Provider abstraction (voyage | openai | local)
    feeds/ rss/ readability/   # Ingestion + extraction
    gamify/ srs/ study/ tasks/ # XP, FSRS, study plans
    offline/ sync/    # Service worker + desktop two-way sync
    supabase/         # Browser / server / middleware clients
  middleware.ts       # Session refresh + auth gate
supabase/
  migrations/         # 0001–0033 — the real deploy schema
  policies.sql        # RLS + auto-create-profile trigger
drizzle/              # Desktop PGlite bundle source ONLY
electron/             # Desktop shell, build, local schema bundling
.github/workflows/    # ci, sync-feeds, trending, backfill-embeddings
```

## Hosting

**Railway**, configured by `railway.json`. The app runs as a long-lived Node
server (`next start`), and the code assumes that rather than merely tolerating
it:

- Cron passes work to a **4-minute** budget instead of ~8 seconds, so a large
  feed list finishes a lap in one run and trending scores the whole library.
- Uploads are **20 MB** on web as well as desktop — there is no serverless body
  cap to duck under.
- The Daily Brief, quizzes and study plans use the **stronger model** with full
  output budgets; those were downgraded purely to fit a 10-second function.
- The database pool is sized for **one process** (`max: 10`), not for a fleet of
  functions each opening their own.

Work is still split into steps — brief sections, quiz batches, ThinkTank cards,
translation chunks — but now for the reason that survives the host change:
results stream in as they land, and one failed step doesn't cost the rest.

A serverless host would still build this repo, but the timings above would not
hold and several features would time out.

Cron is **GitHub Actions** (`sync-feeds` every 2h, `trending` hourly),
authorised with a `CRON_SECRET` bearer token — free, inspectable, and portable
if the host ever changes.

`/api/health` is an unauthenticated liveness probe — it touches no database, and
is excluded from the middleware matcher so it answers `200` rather than
redirecting a cookieless prober to `/login`.

## Architecture notes

- **Drizzle over Prisma** — first-class `pgvector` column type, smaller bundle.
- **`postgres-js` over `node-pg`** — single connection, low overhead; use the
  Supabase **transaction pooler** (6543) in production.
- **Supabase SSR pattern** — `middleware.ts` refreshes the session cookie on
  every request and forwards the verified user in a stripped-then-set header,
  so server components don't pay a second auth round-trip.
- **HNSW over IVFFlat** — faster cold queries, no `ANALYZE` seeding step.
- **CSP is built in `next.config.ts`** from `NEXT_PUBLIC_SUPABASE_URL`, which is
  why that variable must be present at **build** time, not just runtime.
- **`output: "standalone"` is gated behind `DESKTOP_BUILD`** — only the Electron
  build bundles its own server.
- **Changelog is a shipping step.** User-facing changes prepend an entry to
  `src/data/changelog.ts`; the newest `id` drives the in-app "What's New" panel.
  See [CLAUDE.md](CLAUDE.md).
