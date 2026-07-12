# Handover — App Improvement Pass (2nd Brain)

Written 2026-07-12 on branch `claude/app-improvement-plan-sxsshv`; **updated
the same day after a second working pass** that executed roadmap items 1–4
and added more. This continues (and supersedes the open items of)
`OPTIMIZATION_HANDOVER.md` / `OPTIMIZATION_PLAN.md` — read those for the perf
history; **do not redo anything they mark done.**

Starting point for you: tree is green (`npx tsc --noEmit` clean, `npm test`
128/128, `npm run lint` = eslint with `--max-warnings 0` passing,
`npm run build` exit 0).

---

## Shipped — pass 1 (commits `cfa3a6c`, `1194316`, `8f57c6f`, `b794ca0`)

1. **RLS gap closed.** `supabase/policies.sql` covered only 9 of 21 user
   tables; the other 12 were readable/writable cross-user via PostgREST with
   the public anon key. Now idempotent and complete. **Owner must re-run it
   in the Supabase SQL Editor** (see checklist).
2. **Trigram search indexes** — `drizzle/0001_search_trgm.sql` (pg_trgm GIN
   on `articles.title/excerpt`, `directory_items.title/content`); serves the
   ILIKE searches with no query changes. **Owner must run it too.**
3. **Real ESLint** — flat config + CI lint step ('npm run lint' previously
   only printed a setup prompt: there was no config, linting never ran).
4. **Invite-only signup** — `SIGNUP_INVITE_CODE` env gates /signup through a
   server action + service-role `admin.createUser` (timing-safe compare).
   Unset ⇒ old behavior. Pair with disabling public signups in Supabase Auth.

## Shipped — pass 2 (this update)

5. **Zero lint warnings + `--max-warnings 0` ratchet.** Dead imports/vars
   removed (11 files); `directory-shell` complex dep expression extracted;
   `daily-brief`'s stale `savedPrompt` dep dropped (callback reads
   `savedPromptRef` by design); the four intentional per-ID effects carry
   explanatory eslint-disable comments; `_`-prefix formalized as the
   ignored-binding convention via rule options.
6. **Account deletion** — Danger zone card in /settings (web only).
   `deleteAccountAction` in `src/app/(app)/settings/actions.ts`: deletes
   `sync_tombstones` (the one table with no profiles FK), then the `profiles`
   row (cascades all 19 FK'd tables), then the auth user via the admin API.
   Type-DELETE confirmation enforced client- AND server-side.
7. **Per-user daily AI token budget** — `src/lib/ai/budget.ts`, storing a
   per-user per-UTC-day token total in `rate_limits` (bucket
   `ai-tokens-YYYY-MM-DD`). Wired into `/api/ask`, `/api/ask-document`,
   `/api/brief`, `/api/rabbithole` (check → 429 + record `usage.totalTokens`)
   and `/api/ask/followups` (silently returns empty over budget). Enabled by
   `AI_DAILY_TOKEN_BUDGET` env; unset = unlimited (single-user default).
8. **XSS audit (no fix needed)** — both `dangerouslySetInnerHTML` sinks
   (article-reader, item-viewer) are fed exclusively by
   `/api/articles/[id]` + `/full-text`, which sanitize server-side via
   `cleanHtml` (sanitize-html: scripts/handlers/iframes/schemes stripped).
   `src/lib/readability/extract.ts` also sanitizes at write time.
9. **MCP token compare is now timing-safe** (`node:crypto.timingSafeEqual`).
10. **Full-library /search page** — `src/lib/search.ts` +
    `src/app/(app)/search/page.tsx`. Server-rendered; keyword pass (trigram
    ILIKE, feed articles + directory items, 25 each, query-anchored
    snippets) + semantic pass (`retrieveFromDirectory`, fail-soft to
    keyword-only without embeddings), kind filter chips, similarity badges.
    Command palette: new "Search library" nav entry + "See all results for …"
    row (`/search?q=`). Route: 106 kB first load (server-rendered).

## Owner action checklist (not automatable from CI)

- [ ] Run `supabase/policies.sql` in Supabase SQL Editor (critical — closes
      the cross-user data exposure).
- [ ] Run `drizzle/0001_search_trgm.sql` there too.
- [ ] If multi-user: set `SIGNUP_INVITE_CODE` + disable public signups in
      Supabase Auth; consider `AI_DAILY_TOKEN_BUDGET` (e.g. 500000).
- [ ] Still pending from the previous handover: authenticated browser smoke
      (/today brief streaming, /directory wikilinks, /ask streaming, /feeds
      j/k with an article open — now also /search results + palette row) and
      the pg_stat_statements slow-query check:
      `select query, calls, mean_exec_time from pg_stat_statements order by total_exec_time desc limit 15;`

---

## Roadmap — remaining + NEWLY IDENTIFIED gaps, in priority order

### 1. E2E smoke tests (Playwright) — kills a recurring gap
Two handovers in a row have carried "manual browser smoke" as un-executable
inside the agent sandbox. A Playwright suite (login via a seeded test user →
/feeds j/k → open article → /search → /today brief renders) run in CI against
`npm start` + a disposable Supabase (or PGlite) would close it permanently.
The repo has no e2e harness at all today; Chromium is preinstalled in agent
sandboxes at `/opt/pw-browsers/chromium` (`PLAYWRIGHT_BROWSERS_PATH` is set).

### 2. Rate-limit the unauthenticated auth surface — small, real
`inviteSignupAction` can be brute-forced (the timing-safe compare protects
against timing, not volume — invite codes are low-entropy). `checkRateLimit`
needs a userId, so key it by IP (`headers().get("x-forwarded-for")`) in a new
bucket, or add a tiny in-memory limiter for the action. Same consideration
for login attempt flooding (Supabase has its own limits — verify they're on).

### 3. Content-Security-Policy header — defense in depth
`next.config.ts` sets nosniff/frame/referrer/permissions headers but no CSP.
With sanitized article HTML + remote images from arbitrary feed domains,
a workable start: `default-src 'self'; img-src https: data:; media-src
https:; connect-src 'self' https://*.supabase.co; script-src 'self'
'unsafe-inline'` — Next inline runtime scripts need nonces to drop
`'unsafe-inline'`; see Next docs on middleware-generated nonces. Test the
service worker + Electron desktop build before shipping.

### 4. AI usage meter in settings — cheap UX win on top of item 7
The data now exists (`rate_limits` bucket `ai-tokens-<day>`). A small card in
/settings showing "today's AI usage: N / budget" (read via a server
component) makes the budget legible instead of a surprise 429.

### 5. Semantic search over UNSAVED feed articles
`/search`'s semantic pass covers the Directory only (that's what
`retrieveFromDirectory` indexes). `article_embeddings` also exist for feed
articles not saved to the Directory — extend `src/lib/search.ts`'s
`semanticSearch` with a second vector query over `article_embeddings`
joined to `articles` (no directory_items join), merged + deduped by URL/id.

### 6. Password & email change in settings
Only the forgot-password flow exists. `supabase.auth.updateUser({ password })`
/ `{ email }` (email triggers a confirmation mail) in a small settings card.

### 7. Error monitoring
Failures currently vanish into console.warn / route 500s. Sentry's Next.js
SDK (or a self-hosted GlitchTip) with source maps uploaded in CI; scrub PII
(article/note content) from breadcrumbs. Gate the DSN behind env so
self-hosters aren't forced into it.

### 8. Carried features (do when the user asks)
- **Public share links** for notes (`share_slug` + `/share/[slug]` public
  route + a scoped RLS select policy). Changes security posture — confirm
  with the user first.
- **Daily-brief email digest** (cron workflow + Resend/other provider +
  per-user opt-in in `user_settings.settings`).
- **/feeds tag-query fold** — still low value, skip without TTFB complaints.
- **Feed favicon `unoptimized`** — only investigate on the real deploy target.

## Constraints / gotchas (inherited + new)

- Source under `src/`; paths with `(app)` need shell quoting.
- `pdf-parse` imported via `require("pdf-parse/lib/pdf-parse.js")` on purpose.
- `output: "standalone"` gated behind `DESKTOP_BUILD`; `APP_RUNTIME=desktop`
  switches db to PGlite — cloud-only SQL (RLS, trgm) must NOT be assumed
  present on desktop; account deletion + invite signup are web-only by guard.
- Feeds infinite-scroll orderBy must match `loadMoreArticlesAction`
  (id tiebreaker).
- `scripts/vitest.mjs` launcher: keep the exports-based bin resolution and
  `realpathSync.native` cwd normalization.
- New markdown rendering must go through `@/components/ui/markdown`.
- Lint is `--max-warnings 0` now — new intentionally-unused bindings must be
  `_`-prefixed, and hook-dep exceptions need a justified eslint-disable line.
- In THIS sandbox `npm ci` fails on sharp's libvips download (proxy 403) —
  use `npm ci --legacy-peer-deps --ignore-scripts`; lint/tsc/tests/build all
  work without sharp binaries. GitHub Actions CI has open network and is fine.
- `supabase/policies.sql` must be re-run after ANY new table — it's the only
  thing standing between PostgREST and cross-user reads.
- The AI budget module fails OPEN and is a no-op without
  `AI_DAILY_TOKEN_BUDGET`; `recordAiUsage` reuses `rate_limits.count` as a
  token accumulator — don't "fix" that column back to a request counter.
