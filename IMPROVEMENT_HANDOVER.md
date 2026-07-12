# Handover — App Improvement Pass (2nd Brain)

Written 2026-07-12 by the Claude Code session on branch
`claude/app-improvement-plan-sxsshv`. This continues (and supersedes the open
items of) `OPTIMIZATION_HANDOVER.md` / `OPTIMIZATION_PLAN.md` — read those for
the perf history; **do not redo anything they mark done.**

Starting point for you: tree is green (`npx tsc --noEmit` clean, `npm test`
128/128, `npx eslint .` 0 errors / 21 warnings, `npm run build` exit 0).

---

## What THIS session shipped (4 commits on the branch)

1. **`security(rls)` — the big one.** `supabase/policies.sql` previously
   enabled RLS on only 9 of 21 user-owned tables. The other 12
   (`directory_folders/items/links/tasks/flashcards`, `rabbithole_nodes`,
   `player_profile`, `skills`, `xp_events`, `user_settings`, `rate_limits`,
   `sync_tombstones`) were exposed read/write to ANY holder of the public anon
   key via Supabase PostgREST — i.e. cross-user data access. The file is now
   idempotent (drop-if-exists + create, generic owner-policy loop) and covers
   every table. **⚠️ SQL is not applied by CI — the owner must re-run
   `supabase/policies.sql` in the Supabase SQL Editor** (DEPLOY.md now says
   this too).

2. **Trigram search indexes** — `drizzle/0001_search_trgm.sql` (pg_trgm GIN on
   `articles.title/excerpt`, `directory_items.title/content`). The ⌘K palette
   searches with `ILIKE '%q%'` (`src/app/(app)/search-actions.ts`) which was
   seq-scanning full note bodies per debounced keystroke. No query changes
   needed — the planner uses trgm GIN for ILIKE automatically. **Owner must
   run this SQL file in Supabase too.**

3. **Real ESLint** — `npm run lint` used to invoke deprecated `next lint`
   with NO eslint config in the repo: it only ever printed an interactive
   setup prompt; linting never ran anywhere. Now: `eslint.config.mjs` (flat,
   next/core-web-vitals + next/typescript via FlatCompat), script is
   `eslint .`, CI runs it (`.github/workflows/ci.yml`). Fixed the 7 errors it
   found (unescaped apostrophes, `any`s in epub/opml parsers, `{}` generic in
   rss parser, `require()` in tailwind config). 21 warnings remain
   (unused vars, hook deps) — cleaning them is a nice small task.

4. **Invite-only signup (multi-user)** — set `SIGNUP_INVITE_CODE` and /signup
   requires the code, creating accounts via a server action with the
   service-role admin API (timing-safe compare, email pre-confirmed, then
   `signInWithPassword`). Unset ⇒ old behavior exactly. Files:
   `src/app/signup/{page,signup-form,actions}.tsx|ts`,
   `src/lib/supabase/admin.ts` (first service-role client — reuse it for
   account deletion). **Pair with turning OFF "Allow new users to sign up" in
   Supabase Auth settings**, or the anon signup endpoint remains callable
   directly (documented in `.env.example`).

Also audited (no code change needed): every API route except the
deliberately-token/desktop-gated ones (`cron/*` = CRON_SECRET, `mcp` =
X-MCP-Token, `sync` + `desktop/*` = desktop runtime) authenticates via
`getApiUser()` and scopes queries by `user.id`; body parsing is hand-validated
(try/catch, trims, UUID regex, length caps) — zod would be churn, not a fix.
Rate limiting (`src/lib/rate-limit.ts`) is already wired into all AI routes.

## Owner action checklist (not automatable from CI)

- [ ] Run `supabase/policies.sql` in Supabase SQL Editor (critical — closes
      the cross-user data exposure).
- [ ] Run `drizzle/0001_search_trgm.sql` there too.
- [ ] If multi-user: set `SIGNUP_INVITE_CODE` env on the host AND disable
      public signups in Supabase Auth settings.
- [ ] Still pending from the previous handover: authenticated browser smoke
      (/today brief streaming, /directory wikilinks, /ask streaming, /feeds
      j/k with an article open) and the pg_stat_statements slow-query check.

---

## Roadmap — next agent, in priority order

### 1. Account deletion (danger zone in /settings) — medium effort
The missing piece of the account lifecycle (export already exists at
`/api/export/*`). Build: a server action that (a) re-authenticates intent
(type-DELETE confirmation client-side), (b) calls
`createSupabaseAdminClient().auth.admin.deleteUser(user.id)`. All 21 tables
FK onto `profiles.id` (which FKs onto `auth.users`) with `onDelete: cascade`,
so deleting the auth user cascades the whole dataset — verify that chain on a
scratch account first, especially `profiles` → its dependents. Surface in
`src/app/(app)/settings/` as a "Danger zone" card. Desktop caveat: guard with
`process.env.APP_RUNTIME !== "desktop"` (PGlite has no Supabase admin API).

### 2. Dedicated /search page with hybrid retrieval — the best feature win
The palette caps at 6+6 title/body ILIKE hits. The app ALREADY has the whole
retrieval stack: embeddings per article/chunk (`article_embeddings`,
`document_chunks`), hybrid keyword+semantic search in `src/lib/ai/rag.ts`
(see `retrieveFromDirectory`, used by /api/mcp and /ask). A /search route that
runs the same hybrid retrieval with pagination + kind filters (article / note
/ document / rabbithole) + highlighted snippets (`ts_headline` or client-side)
would make the library actually explorable. Reuse `GlobalSearchHit` shape;
add `⌘K → "See all results"` linking into it.

### 3. Per-user AI spend budget — multi-user cost safety
`checkRateLimit(userId, bucket, limit, window)` exists and gates request
COUNTS, but a hostile/enthusiastic user can still burn tokens. Add a daily
token budget: accumulate `usage.totalTokens` from the AI SDK responses into a
`rate_limits`-style counter bucket (e.g. `ai-tokens:<dateKey>`), reject over
budget with a friendly message. All AI entry points already funnel through a
handful of routes (`ask`, `ask-document`, `brief`, `curriculum`, `gaps`,
`study-plan`, `rabbithole`, `connections`, `takeaways`, `followups`).

### 4. Lint-warning cleanup + `--max-warnings` ratchet — small
21 warnings, mostly unused imports (`and`, `inArray`, …) and two
`react-hooks/exhaustive-deps`. Fix them, then add `--max-warnings 0` to the
lint script so it can't regress. The two hook-deps ones need actual thought —
don't blind-fix those.

### 5. Public share links for notes — feature, medium-large
`directory_items` sharing: a `share_slug` column + a public route
`/share/[slug]` rendering read-only markdown (no auth), plus RLS policy
`for select using (share_slug is not null)` scoped to the slug lookup. Only
do this if the user actually wants it — it changes the security posture.

### 6. Daily-brief email digest — feature, medium
The brief generator exists (`/api/brief`, `src/lib/ai/…`). A cron (GitHub
Actions like sync-feeds.yml) that renders the brief per user and emails it
(Resend free tier) would close the "come back daily" loop. Needs an email
provider decision + per-user opt-in flag in `user_settings.settings`.

### 7. Deferred / blocked (carried from previous handover)
- **DB slow-query measurement**: run in Supabase SQL editor —
  `select query, calls, mean_exec_time from pg_stat_statements order by total_exec_time desc limit 15;`
  Only add indexes if a real plan shows a problem.
- **/feeds tag-query fold** (`src/app/(app)/feeds/page.tsx:108`): genuinely
  sequential; low value; skip unless feeds TTFB complaints.
- **Feed favicon `unoptimized`**: only investigate on the real deploy target.

## Constraints / gotchas (inherited + new)

- Source under `src/`; paths with `(app)` need shell quoting.
- `pdf-parse` imported via `require("pdf-parse/lib/pdf-parse.js")` on purpose.
- `output: "standalone"` gated behind `DESKTOP_BUILD`; `APP_RUNTIME=desktop`
  switches db to PGlite (`src/lib/db/index.ts`) — cloud-only SQL (RLS, trgm)
  must NOT be assumed present on desktop.
- Feeds infinite-scroll orderBy must match `loadMoreArticlesAction`
  (id tiebreaker).
- `scripts/vitest.mjs` launcher: keep the exports-based bin resolution and
  `realpathSync.native` cwd normalization.
- New markdown rendering must go through `@/components/ui/markdown`
  (lazy wrapper), never import react-markdown directly.
- In THIS sandbox `npm ci` fails on sharp's libvips download (proxy 403) —
  use `npm ci --legacy-peer-deps --ignore-scripts`; lint/tsc/tests/build all
  work without sharp binaries. GitHub Actions CI has open network and is fine.
- `supabase/policies.sql` must be re-run after ANY new table — it's the only
  thing standing between PostgREST and cross-user reads.
