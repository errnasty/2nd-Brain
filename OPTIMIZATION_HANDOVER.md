# Handover — Open Optimization Items (2nd Brain)

> **STATUS UPDATE — 2026-07-12, second pass (Claude Code):**
> - Item 0: was already done (all four commits landed before this pass).
> - Item 2 ✅ ArticleReader is now `next/dynamic`, mounted only when an article is selected; empty-state pane moved to `FeedsShell`. NOTE: the doc's claim that j/k works with nothing selected was wrong — `useShortcuts(..., !!article)` gates shortcuts on a loaded article, so no re-homing was needed. /feeds 196→177 kB.
> - Item 3 ✅ `scripts/inject-sw-buildid.mjs` stamps both cache names with the Next build id via npm `postbuild` and inside `electron/build.js` (which bypasses npm hooks). Verified: two consecutive builds produced two distinct stamped ids.
> - Item 4 ✅ (was smaller than written): the lockfile had ALREADY resolved the RC caret to react 19.2.6 stable + next 15.5.18 — runtime was never on the RC. Fixed package.json pins to `^19.2.6` and bumped `@types/react(-dom)` to ^19. 128/128 tests green.
> - Item 5 ✅ `experimental.reactCompiler: true` + `babel-plugin-react-compiler@1.0.0`. Build clean (`✓ reactCompiler`). Route sizes +1–4 kB (inserted memoization) in exchange for cheaper re-renders.
> - Item 1 ◐ HTTP-level smoke done against `npm start`: `/` 307→login, `/login` 200 + security headers, `/manifest.webmanifest` 200 (middleware fix verified), `/sw.js` 200, `/api/cron` 401 JSON. **Still manual:** authenticated visual check of markdown rendering (/today, /directory note wikilinks, /ask streaming) and /feeds reader + j/k with an article open.
> - Item 6 ✖ blocked: direct prod-DB reads (pg_stat_statements) were denied by the session's permission policy. Run yourself: `select query, calls, mean_exec_time from pg_stat_statements order by total_exec_time desc limit 15;` in the Supabase SQL editor.
> - Extra (not in this doc): security headers added in `next.config.ts` (nosniff, X-Frame-Options DENY, Referrer-Policy, Permissions-Policy with `microphone=(self)` for Ask voice input) + `poweredByHeader: false`.

Written 2026-07-12 by the agent that picked up the `OPTIMIZATION_PLAN.md` handoff.
This doc covers ONLY what was **left open** from that plan plus one follow-up. The
prior session's P1/P2/auth/middleware work and this session's vitest fix + service-worker
bump are done and described in `OPTIMIZATION_PLAN.md` — **do not redo them.**

All facts below were verified by reading the source this session (file:line references
given). Build + test are currently green (`npm run build` exit 0; `npm test` = 128/128),
so you are starting from a known-good tree.

---

## 0. FIRST STEP — commit the existing working-tree changes

Nothing is committed. The tree currently holds:
- Prior session: P1 lazy-markdown, P2 rabbithole `Promise.all`, auth-page dynamic
  imports, middleware matcher exclusions (`git diff` shows 13 modified files).
- This session: `scripts/vitest.mjs` rewrite (vitest launcher fix), `public/sw.js`
  cache-version bump, `OPTIMIZATION_PLAN.md` corrections.
- Untracked: `OPTIMIZATION_PLAN.md`, `scripts/vitest.mjs`, `src/components/ui/markdown.tsx`,
  `src/components/ui/markdown-impl.tsx`.

Review and commit in logical chunks (the P1 markdown split, the perf/parallelization,
the test fix) before piling on more. The plan explicitly flagged review+commit as the
next step. **Don't commit the `OPTIMIZATION_HANDOVER.md` I'm adding** unless you want it.

---

## 1. Manual browser smoke test (verification gap — NOT a code change)

**Why open:** No browser is available inside the agent environment, so the P3 "manual
smoke" items could not be exercised. The build + unit tests pass, but the lazy
`<Markdown>` wrapper's runtime behavior was never visually confirmed.

**What to check (human or real browser):** after a `npm run build && npm start` (or
deploy preview):
- `/today` (landing): the daily brief **streams** its markdown; first paint shows
  plain-text fallback, then upgrades to rendered markdown (proves the `<Suspense>`
  fallback → impl swap works while streaming, not just on full payloads).
- `/directory`: open a note → markdown renders, and **wikilinks** resolve via the
  custom `mdComponents` prop (`src/components/directory/item-viewer.tsx`).
- `/ask`: an answer streams and renders as markdown.
- `/rabbithole`: the hole/branch panels render markdown.
- `/feeds`: article reader renders; **j/k keyboard nav still works with no article
  selected** (this is owned by `ArticleReader`'s `useShortcuts` — see item 2).

**Failure mode to watch:** a regression in the lazy wrapper surfaces as **unstyled
plain text**, not a crash — so a "looks fine" check is NOT enough; confirm headings/
bold/links actually render.

---

## 2. `/feeds` ArticleReader code-split (the one real remaining bundle win)

**Route weight:** `/feeds` = 196 kB First Load JS (post-P1). The plan's note is accurate
here, unlike the `/directory` one.

**Root cause (verified):** `ArticleReader` is mounted **unconditionally** in
`src/components/feeds/feeds-shell.tsx:84` — it is NOT behind a `selectedId` check. It is
heavy: 712 lines, pulls in `next/image`, `RelatedPanel`, `DocQueryPanel`
(`@/components/ui/markdown`'s sibling but separate), `SelectionToCard`, TTS, reader
prefs, etc. It also **owns two things the shell needs even when no article is open**:
- `useShortcuts({...})` at `article-reader.tsx:289` (j/k paging + arrow nav works with
  nothing selected — see the smoke test above).
- The empty-state pane (no selection UI).

**Correct implementation (the plan's "CAUTION" is the plan — follow it):**
1. Move `useShortcuts(...)` from `ArticleReader` up into `FeedsShell`
   (`src/components/feeds/feeds-shell.tsx`). Pass `selectedId` + `orderedIds` so the
   j/k handlers still work. Confirm the existing `onSelect` callback is reused.
2. Move the empty-state (no-article-selected) JSX up into `FeedsShell` (it currently
   lives inside `ArticleReader`).
3. Now `ArticleReader` can be lazy-loaded: `const ArticleReader = dynamic(() => import("./article-reader").then(m => m.ArticleReader), { ssr: false })`. Render it only when `selectedId` is set:
   `{selectedId && <ArticleReader selectedId={selectedId} orderedIds={orderedIds} onSelect={onSelect} />}`. The `useEffect` sync of `selectedId` from `?article=` in `feeds-shell.tsx:38` already makes this safe — when a deep link arrives, `selectedId` is set on first render and the dynamic chunk loads then.
4. Keep `feeds-nav` + `article-list` eager (they're the always-shown surface). The win
   is purely deferring the reader + its imports (incl. its `next/image`, panels, markdown
   siblings) until an article is opened.

**Hard constraints (verified):**
- `FeedsShell` owns `selectedId`/`orderedIds` and the scope-change clear logic
  (`feeds-shell.tsx:48-63`). Do not move that.
- The feeds infinite-scroll `orderBy` MUST stay in sync with `loadMoreArticlesAction`
  (id tiebreaker) — comment at `src/app/(app)/feeds/page.tsx:87`. This refactor touches
  client shell only, so it's unaffected, but don't touch the page query.
- `ArticleReader` fetches takeaways/related via client routes (`/api/articles/:id/...`)
  — those stay as-is.

**Verification:** rebuild → `/feeds` First Load JS should drop below 196 kB (target the
reader's weight, roughly the `/documents` 132 kB neighborhood if the reader is the bulk).
Then run the item-1 smoke test for `/feeds` **with focus on keyboard nav**. This is the
one item where a browser check is mandatory before declaring done.

**Effort:** medium. **Risk:** keyboard-nav regression if `useShortcuts` isn't correctly
re-homed. Do NOT skip the smoke test.

---

## 3. Service worker: make the cache-version bump automatic per deploy

**Context:** I manually bumped `STATIC_CACHE` v1 → v2 in `public/sw.js` this session to
purge the accumulated stale chunks. But that's a one-time manual purge — a future deploy
will again accumulate chunks under `sb-static-v2` until someone remembers to bump it.

**Fix to automate:** `public/sw.js` is a static file (Next copies `public/` verbatim;
webpack does NOT process it), so environment variables aren't available at build time.
Add a tiny build step that injects the build id into the SW:
- Option A (simplest): a `scripts/inject-sw-buildid.mjs` that reads `.next/BUILD_ID` and
  does a string replace of a placeholder in `public/sw.js` (e.g.
  `const STATIC_CACHE = "sb-static-__BUILD_ID__";`), run via a `prebuild` or `postbuild`
  npm script. Guard so it only replaces once / is idempotent.
- Option B: copy `sw.js` → `public/` from a template at build time with the id injected.
- Then derive `STATIC_CACHE` from `NEXT_BUILD_ID` instead of a hand-bumped literal, so
  every deploy gets a fresh cache name and the `activate` handler purges the old one.

**Verification:** build twice with different content, confirm `public/sw.js` (or the
emitted copy) shows a distinct cache name each build; old cache names still get deleted
by the existing `activate` keep-set logic (`public/sw.js` activate handler).
**Impact:** storage-only (not speed) — non-blocking, but it's the clean finish to item 3
in the plan.

---

## 4. React 19 RC → stable

**Current pin:** `react@19.0.0-rc-66855b96-20241106` / `react-dom` same
(`package.json:60-61`). `@types/react` is still `^18.3.x` (line 77) — will need bumping
to `^19` alongside.

**Why its own PR:** React 19 RC carries RC-only behavior/caveats. Upgrading to stable
19.x pulls perf fixes and removes RC risk, but is a broad surface change (every client
component, hooks, server components). Per the plan: do as its own PR with a **full
regression pass** (the unit suite is only 128 tests covering pure logic — it will NOT
catch React-version regressions in rendering). The item-1 browser smoke is the real gate.

**Prerequisite for item 5.**

---

## 5. React Compiler (experimental.reactCompiler)

**Why deferred behind item 4:** Next 15's `experimental.reactCompiler` needs
`babel-plugin-react-compiler` installed, and the app currently runs the React 19 **RC**
pin; bump to stable first (item 4) before enabling the compiler.

**Where it'd help (verified by reading):** `feeds-nav` and `directory-nav` are heavily
re-rendering client components with hand-rolled `useMemo`/`useTransition` guards
(`src/components/directory/directory-nav.tsx`, the feeds nav under `src/components/feeds/`).
The compiler auto-memoizes prop/value churn that's currently hand-optimized, reducing
re-render cost on folder/tag switching.

**Steps:** `npm i babel-plugin-react-compiler`, add to `next.config.ts` under
`experimental.reactCompiler` (see Next 15 docs — the key must match your Next version's
expected shape). Be aware it **adds build time**. Verify no render regressions via the
item-1 smoke (nav switching, drag interactions, keyboard nav).
**Effort:** medium. **Win:** medium (render perf, not bundle size).

---

## 6. DB slow-query measurement (no blind index work)

**Current state:** schema indexes are already comprehensive (`src/lib/db/schema.ts`).
The plan is explicit: do NOT add indexes speculatively.

**Next lever:** enable slow-query logging in Supabase (or your Postgres host) and measure
the heavy aggregates against **real data volume**:
- `fetchStudyStats` (study hub stats)
- gamify award path (achievements/rules — `src/lib/gamify/`)
- the map API (`/api/map`, `src/lib/...map`)
Profile with `EXPLAIN (ANALYZE, BUFFERS)` on realistic row counts. Only add an index if
a real query plan shows a seq scan / bad join on hot paths.
**Effort:** low-to-medium, purely investigative. **No code change expected** unless a
plan proves an index is missing.

---

## 7. Lower-priority / optional (copied from the plan, unchanged)

- **P2 `/feeds` tag query** (`src/app/(app)/feeds/page.tsx:108`): the tags query depends
  on the just-fetched `ids` array, so it's genuinely sequential. Plan marked it
  **low value — skip unless feeds TTFB becomes a complaint.** Only revisit if someone
  reports slow `/feeds` server time. (Note: `:108` is the `itemTags` select; it runs
  after `rows` are fetched at `:85-90`. Folding into a lateral join/`IN (subquery)` is
  the only way to parallelize, and the id-tiebreaker ordering at `:87-89` MUST be
  preserved identically in any subquery.)
- **`optimizePackageImports`**: already handled by Next 15 defaults for `lucide-react`.
  Only add to `next.config.ts` `experimental.optimizePackageImports` if new icon/util
  libs are introduced. No action now.
- **`/feeds` images `unoptimized` for tiny favicons**: `next/image` with
  `images.remotePatterns` allowing all https (needed for RSS) — `next.config.ts:24-26`.
  If deployed on Netlify, confirm the optimizer isn't doing an origin fetch per favicon
  view (cost may exceed benefit for already-small icons). Consider `unoptimized` on the
  feed-favicon `<Image>` only. **Verify on the actual deploy target** before changing.

---

## Constraint reminders (from the plan + this session)

- Source lives under `src/` (not root `app/`). Windows dev machine; paths with `(app)`
  need quoting in shells: `cd "src/app/(app)/feeds"`.
- `pdf-parse` is imported via `require("pdf-parse/lib/pdf-parse.js")` deliberately
  (serverless crash workaround) — don't "clean it up".
- `output: "standalone"` is gated behind `DESKTOP_BUILD` (`next.config.ts:7`) — don't
  unconditionalize.
- Study page uses `Promise.allSettled` deliberately — keep that pattern.
- Build: `npm run build` (Node v24 on this machine). Test: `npm test` (vitest).
- **Vitest launcher gotcha (fixed this session, don't regress):** `scripts/vitest.mjs`
  must resolve the `vitest.mjs` bin through `vitest/package.json`'s `exports`, NOT
  `vitest/vitest.mjs` (that subpath isn't exported in vitest 4 and throws). If you touch
  the launcher, keep the `realpathSync.native(process.cwd())` casing-normalization call —
  it prevents the old Windows drive-letter `config`-undefined failure mode.

## Suggested order

1. **Item 0** — commit what's already done.
2. **Item 2** (`/feeds` ArticleReader split) — biggest real bundle win; do it next, with
   the item-1 browser smoke as its gate.
3. **Item 1** — browser smoke (gates items 2/4/5).
4. **Item 3** — automate the SW cache-version bump (cheap finish).
5. **Item 4 → 5** — React 19 stable, then React Compiler (own PRs, full regression).
6. **Item 6 / 7** — measurement + optional cleanups, as needed.
