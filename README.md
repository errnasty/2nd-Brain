# Second Brain

A self-hosted RSS reader + document library + AI briefing engine, built on Next.js (App Router), Supabase (Postgres + `pgvector` + Auth), Drizzle ORM, Shadcn UI, and the Vercel AI SDK.

**Phases 1, 2, and 3 are done.** Phase 1: scaffold + Supabase magic-link SSR + Drizzle schema with `pgvector`. Phase 2: `rss-parser` ingestion + on-demand `@mozilla/readability` extraction + Vercel-Cron sync + three-column Inoreader-style reader with optimistic mark-as-read. Phase 3: drag-and-drop uploads for PDF / MD / TXT / ePub with a recursive ~1000-token chunker writing to `document_chunks`. Plus: **OPML import** from Inoreader, **Times New Roman** reader font (user-adjustable), **keyboard shortcuts** (`j`/`k`/`m`/`s`/`v`/`esc`), reading time, prev/next nav, and a font / size / theme picker. Phases 4–5 (Daily Brief + embeddings + auto-tagging, PWA polish) are next.

**👉 Deploying for the first time? See [DEPLOY.md](DEPLOY.md) for the step-by-step walkthrough.**

---

## Prerequisites

- **Node.js ≥ 18.18** (current `node -v` on this machine reports 16.15.0 — upgrade before running anything). Node 20 LTS is recommended for Vercel parity.
- A free Supabase project. Enable the `vector` extension in **Database → Extensions** (or apply the migration below).
- API keys: `ANTHROPIC_API_KEY` for the Daily Brief, `OPENAI_API_KEY` for embeddings.

> **Note on embeddings:** Anthropic does not ship an embeddings API. The app defaults to OpenAI `text-embedding-3-small` (1536 dims). Voyage AI is Anthropic's recommended embeddings partner — switch by setting `EMBEDDINGS_PROVIDER=voyage` in Phase 4.

## Quick start

```bash
# 1. Install deps (after upgrading Node ≥ 18.18)
npm install

# 2. Copy env template, fill in Supabase + API keys
cp .env.example .env.local

# 3. Enable pgvector + push the schema
psql "$DATABASE_URL" -f drizzle/0000_enable_pgvector.sql
npm run db:push

# 4. Apply RLS policies + the auth-signup trigger
psql "$DATABASE_URL" -f supabase/policies.sql

# 5. Run the dev server
npm run dev
```

## What's in this phase

```
src/
  app/
    (app)/              # Authenticated app routes (sidebar + main pane)
      layout.tsx        # Server-side auth gate
      page.tsx          # Inbox landing
    auth/callback/      # OAuth/magic-link exchange
    login/page.tsx      # Magic-link sign-in form
    layout.tsx          # Root layout + ThemeProvider + Toaster
    globals.css         # Tailwind + Shadcn tokens + .prose-reader
  components/
    shell/sidebar.tsx   # Left column nav
    theme-provider.tsx
    ui/                 # Shadcn primitives (button, card, input, label, scroll-area, separator)
  lib/
    db/
      schema.ts         # Drizzle schema with pgvector columns
      index.ts          # Drizzle client (postgres-js, single connection for serverless)
    supabase/
      client.ts         # Browser client
      server.ts         # Server-Component client
      middleware.ts     # Session refresh + auth redirect
    utils.ts            # cn() + relative-time formatter
  middleware.ts         # Wires updateSession() across the app
drizzle/
  0000_enable_pgvector.sql
supabase/
  policies.sql          # RLS + auto-create-profile trigger
```

## Schema highlights

- **`profiles`** — extends `auth.users`, stores per-user `systemPrompt`, LLM config, encrypted API keys.
- **`folders`** — supports nesting via `parent_id` and a reserved `is_inbox` flag for AI smart-routing fallback.
- **`feeds` / `articles`** — articles carry `full_text` (Readability output), `read_status`, dedup index on `(feed_id, guid)`.
- **`documents` / `document_chunks`** — chunks store `vector(1536)` embeddings with an HNSW cosine-ops index.
- **`article_embeddings`** — separate table so "Related Knowledge" can search across both kinds with one vector index per kind.
- **`tags` / `item_tags`** — polymorphic many-to-many (`item_kind` ∈ `article|document`). Includes `confidence` and `source` so AI-suggested tags can be distinguished from user-applied ones.
- **RLS** — every owned table is locked to `auth.uid() = user_id`. A trigger on `auth.users` auto-creates the matching `profiles` row.

## Roadmap

- **Phase 2 (done)** — `rss-parser` cron worker; `@mozilla/readability` full-text extractor; three-column reader with optimistic mark-as-read; OPML import; reader settings (font/size/theme) + keyboard shortcuts.
- **Phase 3 (done)** — drag-drop upload zone; recursive chunker (1000 tokens / 200 overlap); PDF + ePub + Markdown + TXT parsers.
- **Phase 4** — Daily Brief streaming via Vercel AI SDK + Anthropic prompt caching; embeddings provider abstraction; semantic "Related Knowledge" sidebar; structured-output auto-tagging + smart folder routing.
- **Phase 5** — swipe gestures, collapsible sidebars, PWA service worker, Vercel deploy template.

## Why each choice

- **Drizzle over Prisma** — first-class `pgvector` column type and edge-runtime friendliness; smaller bundle for serverless invocations.
- **Postgres-js over node-pg** — single connection, no driver overhead, works in Vercel Functions and Edge.
- **Supabase SSR pattern** — `middleware.ts` refreshes the session cookie on every request, so RSC reads always see a fresh user.
- **HNSW over IVFFlat** — faster cold-start queries, no `ANALYZE` step required after initial seed.
