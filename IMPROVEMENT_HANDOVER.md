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

## Shipped — pass 3 (commits `bde0315`, `d357f4c`)

11. **Playwright e2e smoke suite** (roadmap item 1 → done for the
    unauthenticated surface). `e2e/smoke.spec.ts` + `playwright.config.ts` +
    `npm run test:e2e`; boots the prod build with placeholder Supabase env.
    Covers: / redirect, /login + /signup **hydration in a real Chromium with
    console-error assertions** (catches CSP refusals + hydration crashes),
    PWA assets, security headers, cron 401. 6/6 green; wired into ci.yml as
    an `e2e` job. Authenticated flows still need real env + a seeded user —
    gate future specs on `process.env.E2E_AUTH`.
12. **Invite brute-force limiter** (roadmap item 2 → done).
    `src/lib/ip-rate-limit.ts` (in-memory fixed window, capped map) keyed by
    IP in `inviteSignupAction`: 10 attempts / 10 min. In-memory = per
    serverless instance; acceptable friction, documented in the module.
13. **Enforcing CSP** (roadmap item 3 → done). See `next.config.ts` — csp
    const with comments. `script-src 'unsafe-inline'` stays until someone
    does the middleware nonce work; `connect-src` derives the Supabase origin
    from `NEXT_PUBLIC_SUPABASE_URL`. Verified by the e2e hydration specs.
    **Desktop (Electron) build not yet exercised under CSP** — verify before
    a desktop release.
14. **AI usage meter** (roadmap item 4 → done) —
    `src/components/settings/ai-usage-card.tsx`, server-rendered, only shows
    when `AI_DAILY_TOKEN_BUDGET` is set.
15. **Semantic search over unsaved feed articles** (roadmap item 5 → done) —
    `unsavedArticleSemantic` in `src/lib/search.ts` queries
    `article_embeddings` for articles with no directory_items row (saved
    ones excluded to avoid dupes), merged by similarity with directory hits.
    Costs one extra query-embedding call per search (directory + article
    passes embed independently).
16. **Password change card** (roadmap item 6 → done) — web-only settings
    card via `auth.updateUser({ password })`. Email change NOT done (needs
    confirmation-URL config decisions).

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

## Roadmap — what's still open, in priority order

### 1. Authenticated e2e specs
The smoke suite covers the unauthenticated surface. The valuable half —
/feeds j/k with an article open, /search results, /today brief streaming,
/directory wikilinks — needs real Supabase env + a seeded test user. Add
specs gated on `process.env.E2E_AUTH`; in CI, run them only when repo
secrets exist (`if: secrets…` guard on a separate job). This finally
retires the "manual browser smoke" carried across three handovers.

### 2. CSP hardening round 2
- Verify the Electron desktop build under the new CSP before any desktop
  release (`DESKTOP_BUILD=1` + `APP_RUNTIME=desktop`; watch the console).
- Optional: middleware-generated nonces to drop `script-src 'unsafe-inline'`
  (Next docs "Content Security Policy"); touch `src/middleware.ts`, pass the
  nonce through headers. Medium effort, real XSS-hardening payoff.

### 3. Email change in settings
`auth.updateUser({ email })` + Supabase's double-confirmation emails. Needs
the redirect URL configured in Supabase Auth settings — document it in
DEPLOY.md alongside the change.

### 4. Error monitoring
Failures currently vanish into console.warn / route 500s. Sentry's Next.js
SDK (or self-hosted GlitchTip) with source maps uploaded in CI; scrub PII
(article/note content) from breadcrumbs. Gate the DSN behind env so
self-hosters aren't forced into it.

### 5. Carried features (do when the user asks)
- **Public share links** for notes (`share_slug` + `/share/[slug]` public
  route + a scoped RLS select policy). Changes security posture — confirm
  with the user first.
- **Daily-brief email digest** (cron workflow + Resend/other provider +
  per-user opt-in in `user_settings.settings`).
- **/feeds tag-query fold** — still low value, skip without TTFB complaints.
- **Feed favicon `unoptimized`** — only investigate on the real deploy target.
- **Search polish**: one shared query-embedding for the directory + article
  semantic passes (currently embeds twice); `ts_headline`-style highlighted
  snippets; pagination beyond 25+25.

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
- e2e: `npm run build` first, then `npm run test:e2e`; the config auto-uses
  `/opt/pw-browsers/chromium` in agent sandboxes and boots `npm start` on
  :3123 with placeholder env. Vitest's include is `src/**` so the suites
  never collide.
- The AI budget module fails OPEN and is a no-op without
  `AI_DAILY_TOKEN_BUDGET`; `recordAiUsage` reuses `rate_limits.count` as a
  token accumulator — don't "fix" that column back to a request counter.
