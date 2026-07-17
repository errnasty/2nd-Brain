# Handover — App Improvement Pass (2nd Brain)

Written 2026-07-12 on branch `claude/app-improvement-plan-sxsshv`; **updated
the same day after a second working pass** that executed roadmap items 1–4
and added more. This continues (and supersedes the open items of)
`OPTIMIZATION_HANDOVER.md` / `OPTIMIZATION_PLAN.md` — read those for the perf
history; **do not redo anything they mark done.**

> **Update 2026-07-12 (consolidation):** `OPTIMIZATION_PLAN.md` and
> `OPTIMIZATION_HANDOVER.md` have been moved to `docs/history/` — all their
> open items are resolved or carried into the comprehensive plan at
> `.hermes/plans/2026-07-12_200000-comprehensive-improvement-all-aspects.md`.
> This file remains the authoritative handover for owner-action items and
> the full-surface backlog.

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

> A full-surface backlog (every aspect: deps, DB, PWA, a11y, docs, ops,
> feeds, testing, UX, multi-user, misc security) follows after this list —
> these numbered items are just the "do next" cut.

### 0. Two urgent finds from the full-surface audit (details in backlog)
- **Dependency vulnerabilities**: 24 total — 1 critical (protobufjs RCE
  advisory), 7 high incl. drizzle-orm SQL-identifier injection. Run
  `npm audit fix` for the safe subset now; plan the drizzle-orm 0.45 major
  bump as its own PR. (Backlog §A.)
- **Migration drift**: cloud migrations 0008/0013/0018 are referenced by
  code but absent from `drizzle/` — a fresh deploy can't fully rebuild the
  DB and desktop sync hard-errors without 0013. Recover + commit them.
  (Backlog §B.)

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

## Full-surface improvement backlog (all aspects, audited 2026-07-12)

Grounded in this repo's actual state (file references given), not generic
advice. The prioritized roadmap above is the "do next" list; this is the
complete map. Impact/effort tags: 🔴 high-impact, 🟡 medium, ⚪ polish.

### A. Dependencies & supply chain
- 🔴 **`npm audit`: 24 vulnerabilities — 1 critical (protobufjs, arbitrary
  code execution), 7 high (drizzle-orm <0.45.2 SQL-identifier injection,
  undici TLS-bypass/header-injection, form-data CRLF, vite/launch-editor).**
  `npm audit fix` clears several without breakage; drizzle-orm 0.36 → 0.45.2
  is a MAJOR bump — do it as its own PR with the full test+e2e suite, and
  check every raw `db.execute(sql\`…\`)` call site against the 0.4x
  changelog. Find where protobufjs comes from (`npm ls protobufjs` — likely
  transitive via @xenova/transformers) and decide exposure.
- 🟡 No automated dependency updates: add Dependabot/Renovate (weekly,
  grouped), plus a scheduled `npm audit --audit-level=high` CI job so new
  CVEs surface without waiting for a human to run audit.

### B. Database & migrations
- 🔴 **Migration drift — the repo cannot rebuild the production DB.** Code
  references cloud migrations that are NOT in `drizzle/`: tsvector + GIN
  (0008, `src/lib/ai/rag.ts:266` fail-softs to ILIKE), updated_at sync
  triggers (0013, `src/lib/sync/engine.ts:172` HARD-ERRORS without it),
  FSRS columns (0018, `src/lib/db/schema.ts:420`). `drizzle/` holds only
  0000 + 0001. A fresh deploy via `db:push` + policies.sql silently lacks
  the tsvector index and breaks desktop sync. Fix: recover the missing SQL
  from the live DB (`pg_dump --schema-only` diff against `db:push` output),
  commit as numbered files, and switch the workflow from `db:push` to
  `drizzle-kit generate` + committed migrations from here on.
- 🟡 Backup/restore is undocumented: DEPLOY.md should cover Supabase PITR /
  scheduled `pg_dump`, and a restore drill. All user data incl. uploaded
  document full-text lives in this one DB.
- ⚪ Orphan hygiene: embeddings/chunks for deleted content rely on FK
  cascades (fine), but re-embedding after an EMBEDDINGS_PROVIDER switch is
  manual (backfill route) — a startup dimension-mismatch check would catch
  the "switched provider, forgot to re-embed" foot-gun explicitly.

### C. PWA & mobile
- 🔴 **No `share_target` in `public/manifest.webmanifest`** — the highest-value
  missing mobile feature for a read-later app: Android/iOS share-sheet →
  save URL into the Directory. Needs a `/share-save` route that accepts the
  POST, saves, and redirects. Pairs with the existing readability extractor.
- 🟡 Manifest has no `shortcuts` (long-press → Today's Brief / Search /
  Quick capture) and no `screenshots` (install-prompt quality on Android).
- 🟡 Web Push for the Daily Brief ("your brief is ready" each morning) —
  service worker exists; needs push subscription storage + a cron sender.
  Complements (or replaces) the email-digest roadmap item.
- ⚪ App Badging API: unread count on the installed-app icon; cheap win in
  `sw-register.tsx` territory.

### D. Accessibility
- 🟡 **No skip-to-content link** (verified: no match in `src/`): keyboard/AT
  users tab through the whole sidebar on every page. One link in
  `(app)/layout.tsx` + an `id` on the main pane.
- 🟡 Streaming AI answers (/ask, /today) have no `aria-live` region — screen
  readers get silence while text streams in. `aria-live="polite"` on the
  answer container, throttled.
- 🟡 No automated a11y checks: axe-core in the new Playwright suite
  (`@axe-core/playwright`) on /login, /feeds, /settings catches regressions
  for free once wired.
- ⚪ Reduced motion is respected in `page-transition.tsx` only — audit the
  confetti (`confetti.tsx`) and card/board animations under
  `prefers-reduced-motion`.
- ⚪ Contrast audit of the "editorial" theme's muted grays (mono 10-11px
  labels) against WCAG AA.

### E. Documentation & repo hygiene
- 🟡 **README.md is two product-generations stale**: says "Phases 4–5 are
  next" while Daily Brief, embeddings, study hub, SRS, gamification, map,
  rabbitholes, desktop app, MCP server are all shipped. Rewrite the feature
  list + env table (SIGNUP_INVITE_CODE, AI_DAILY_TOKEN_BUDGET, e2e).
- 🟡 CLAUDE.md mandates `graphify query` but `graphify-out/` doesn't exist in
  the repo — either commit the graph artifacts or drop the section (agents
  waste a turn discovering this every session).
- ⚪ ~~Three overlapping handoff docs now exist (OPTIMIZATION_PLAN.md,
  OPTIMIZATION_HANDOVER.md, this file). Fold the two older ones into a
  docs/history/ folder or delete after extracting the still-true constraints.~~
  **Done (2026-07-12):** the two older docs are now in `docs/history/`.
  A comprehensive improvement plan covering all remaining backlog items lives
  at `.hermes/plans/2026-07-12_200000-comprehensive-improvement-all-aspects.md`.

### F. Observability & operations
- 🟡 Error monitoring (already roadmap #4) — still the biggest ops gap.
- 🟡 Cron visibility: sync + backfill run via GitHub Actions; a failure just
  reddens a workflow badge nobody watches. Enable workflow failure
  notifications (or a shields badge in README, or a `last_sync_at` staleness
  banner in the feeds UI — `feeds.last_error` exists per-feed, but there's
  no "the WHOLE sync hasn't run for 2 days" signal for the user).
- ⚪ Structured logs: API routes `console.warn` strings; a tiny logger with
  route + userId(hash) + duration would make Netlify logs greppable.

### G. Feeds & content pipeline
- 🟡 **Dead-feed auto-pause**: `feeds.lastError` is stored and surfaced, but
  a feed 404ing for months is still fetched every cron run. Add
  `error_count` + skip-after-N-consecutive-failures with a "paused, tap to
  retry" state in feeds-nav.
- 🟡 Cross-feed dedupe: the same story from two feeds appears twice
  (unique index is per-feed URL). A normalized-URL (or title-simhash) check
  at insert could mark duplicates and collapse them in the reader.
- ⚪ Import beyond OPML: Pocket/Instapaper/browser-bookmarks HTML into the
  Directory — the parsers + chunker already exist, it's mostly a mapping UI.
- ⚪ Favicon caching: feed favicons hotlink origin servers on every render
  (`next/image` optimizes but still origin-fetches); cache them as data URIs
  at feed-add time.

### H. Testing depth
- 🟡 The 128 unit tests are pure-logic only (chunker, SRS, markers, models);
  ZERO component/DOM tests. Rather than adding a jsdom layer, extend the new
  Playwright suite: authenticated specs (roadmap #1) give more coverage per
  line of test code than component tests would.
- ⚪ Bundle-size regression guard: CI has no budget check — a
  `next build` route-size diff against main (or size-limit on the shared
  chunk) stops the 250 kB-era regressions from creeping back.

### I. Product & UX polish
- 🟡 **No undo / soft-delete anywhere**: deleting a note, feed, folder, or
  rabbithole is immediate and permanent (context menus → server action).
  Cheapest fix: `deleted_at` column on directory_items + a 30-day Trash view;
  alternatively a 5-second "Undo" toast that defers the server action.
- 🟡 Session management: no "sign out everywhere" (Supabase
  `auth.signOut({ scope: 'global' })`) — matters once invite-mode makes
  accounts shared-device-plausible. One button next to Change password.
- ⚪ Quick capture exists (`quick-capture.tsx`) but isn't in the command
  palette ACTIONS list — "New note" / "New task" as palette actions.
- ⚪ /search: query terms aren't highlighted in snippets; `<mark>` wrap is
  ~20 lines in `HitRow`.
- ⚪ Login/signup pages render nothing without JS (fully client-rendered
  behind Suspense — verified in e2e work). Server-render the static shell so
  first paint isn't blank on slow connections.

### J. Multi-user hardening (beyond what shipped)
- 🟡 Per-user BYO API keys: `profiles.encryptedApiKeys` exists in the schema
  but NOTHING reads or writes it (verified: schema.ts is the only
  reference). Either build it (each user pays for their own AI; the clean
  multi-tenant cost model, better than shared-budget 429s) or drop the
  column. Needs a real crypto story (libsodium sealed box with a server
  KEY_ENCRYPTION_SECRET, never the service key).
- 🟡 Per-user resource quotas: uploads have a size cap per file, but there is
  no per-user total-storage or feed-count cap; one user can bloat the shared
  DB. Cheap: count-based caps in the upload/add-feed actions.
- ⚪ Postgres pool: `max: 3` in `src/lib/db/index.ts` was tuned for
  single-user; under real multi-user load on Supabase's pooler, revisit
  (measure first — see the pg_stat_statements item).

### K. Minor security polish
- ⚪ `public/robots.txt` doesn't exist: add a disallow-all (private app;
  keeps the login page out of indexes) + `X-Robots-Tag: noindex` header.
- ⚪ Login lacks its own rate limit (Supabase throttles server-side; the new
  `checkIpRateLimit` makes a client-visible layer a 5-line addition to the
  login action if wanted).
- ⚪ Session cookie hygiene: rely on @supabase/ssr defaults today; verify
  `Secure`/`SameSite` flags on the deploy target once, document in DEPLOY.md.

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
