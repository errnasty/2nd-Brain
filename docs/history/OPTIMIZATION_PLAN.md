# Optimization Plan — 2nd Brain

Status legend: `[x]` done in this session · `[ ]` open — pick up from top (ordered by impact/effort).
Written 2026-07-11 by Claude Code session; intended as a handoff document for the next coding agent.

## Baseline (before this session's changes)

`npm run build` First Load JS (gzipped-ish, Next 15 report):

| Route | First Load JS |
|---|---|
| shared by all | 102 kB |
| /directory | 250 kB |
| /feeds | 239 kB |
| /login, /signup | 221 kB |
| /ask | 206 kB |
| /today (landing) | 205 kB |
| /rabbithole | 190 kB |
| /settings | 165 kB |
| Middleware | 89.2 kB |

What is ALREADY optimized (do not redo): route-level code splitting; `@tanstack/react-virtual` in article-list + directory-shell; `Promise.all`/`allSettled` in study/directory/tags/documents pages; `experimental.staleTimes` router cache; `serverExternalPackages` for transformers/officeparser/pglite; lazy `import("@xenova/transformers")`; `next/font` self-hosting; DB indexes are comprehensive (see `src/lib/db/schema.ts`); sidebar API has ETag/304; `React.cache()` on auth (`src/lib/auth.ts`) so `requireUser()` is one round-trip per request.

## Results of this session (verified by rebuild, exit 0)

P1 + P2 + auth-page/middleware fixes landed. First Load JS before → after:

| Route | Before | After |
|---|---|---|
| /today (landing) | 205 kB | 162 kB |
| /ask | 206 kB | 163 kB |
| /directory | 250 kB | 208 kB |
| /feeds | 239 kB | 196 kB |
| /rabbithole | 190 kB | 147 kB |
| /login | 221 kB | 126 kB |
| /signup | 221 kB | 126 kB |
| /forgot-password | 190 kB | 126 kB |
| /reset-password | 186 kB | 122 kB |

Shared chunk unchanged (102 kB). Changes are uncommitted in the working tree — review + commit is the next agent's (or user's) first step.

✅ `npm test` (vitest 4.1.7) — **fixed this session (2026-07-12).** The `config`-undefined failure was NOT a vitest/Vite version mismatch. Root cause: the `scripts/vitest.mjs` launcher added earlier resolved a non-exported subpath (`vitest/vitest.mjs`), which throws `ERR_PACKAGE_PATH_NOT_EXPORTED` and crashes before vitest ever starts — so `npm test` was dead and masked the fact that the suite itself is green. Rewrote the launcher to (1) normalize cwd casing via `realpathSync.native` and (2) resolve the real `vitest.mjs` bin through the package.json `exports` before spawning it. All 19 files / 128 tests now pass via `npm test`. (Confirmed: `node_modules/.bin/vitest run` also passed, proving the suite was always green.)

## P1 — Lazy react-markdown (biggest bundle win)

- [x] DONE (this session). `react-markdown` + `remark-gfm` (unified/micromark/mdast chain, ~43 kB gz) was statically imported by 6 client components, putting it in the critical path of /today (landing), /ask, /directory, /rabbithole, /feeds, /documents:
  - `src/components/today/daily-brief.tsx`
  - `src/components/ask/ask-shell.tsx`
  - `src/components/directory/item-viewer.tsx` (uses `components={mdComponents}` prop)
  - `src/components/rabbithole/rabbithole-shell.tsx`
  - `src/components/reader/doc-query-panel.tsx` (2 call sites)
  - `src/components/reader/rabbithole.tsx`

  Fix applied: shared lazy wrapper.
  1. `src/components/ui/markdown-impl.tsx` — statically imports ReactMarkdown + remarkGfm, default-exports the configured renderer.
  2. `src/components/ui/markdown.tsx` — `"use client"`, `React.lazy(() => import("./markdown-impl"))` inside `<Suspense fallback={<div className="whitespace-pre-wrap">{children}</div>}>`. Fallback = plain text so streaming AI answers stay readable while the chunk loads.
  3. All 8 call sites replaced with `<Markdown components={...}>{text}</Markdown>`.
  Any NEW markdown rendering must use `@/components/ui/markdown`, never import react-markdown directly.

## P2 — Parallelize sequential DB round-trips

- [x] DONE (this session). `src/app/(app)/rabbithole/page.tsx` — 4 sequential awaits collapsed into one `Promise.all` (holes, recent, selected row, resolved text).
- [ ] `src/app/(app)/feeds/page.tsx:108` tag query depends on fetched article ids — genuinely sequential. Optional: fold into one round-trip with a lateral join or `IN (subquery matching the same filter+limit)`; low value, skip unless feeds TTFB is a complaint.

## P3 — Verify + measure (after each change)

- [x] `npm run build` → verified exit 0; route table matches the After column exactly (e.g. /directory 208 kB, /feeds 196 kB, /rabbithole 147 kB, /login 126 kB). Shared chunk unchanged at 102 kB.
- [x] `npm test` (vitest) → fixed + green: 19 files / 128 tests pass via `npm test` (see corrected warning note above).
- [ ] Manual smoke: /today streams brief markdown; /directory note renders markdown + wikilinks (custom `mdComponents`); /ask answer renders; rabbithole panels render. **NOT done this session** — no browser available in the agent env. The lazy `<Markdown>` wrapper renders a plain-text fallback inside `<Suspense>`, so a regression would surface as unstyled plaintext, not a crash; recommend a quick visual check after deploy.

## P4 — Further candidates (not started, in priority order)

- [~] **/directory (208 kB post-P1) — REVIEWED 2026-07-12: the suggested `directory-dnd-shell` lazy-load is a NO-OP, do NOT do it as written.** `@dnd-kit/core` is NOT only needed in board view: `directory-shell.tsx` statically imports `useDraggable` and uses it in `DraggableItemRow` (the **list** view — the default, always mounted), and `directory-nav.tsx` statically imports `useDraggable`/`useDroppable` (folder drag + Unsorted drop target — also always mounted). The `DndContext` provider (`directory-dnd-shell`) is mounted for every view in `directory/layout.tsx:61`. So code-splitting `directory-dnd-shell` removes none of the dnd-kit code from the critical path, and the rest of the 208 kB is genuinely shell/list/nav code. The only real lever would be dropping dnd-kit for a hand-rolled pointer-drag — out of scope. **No bundle change made.** (This is exactly the "verify with ANALYZE=1 before cutting" risk the item warned about.)
- [x] DONE (this session) **auth pages**: supabase-js AND dexie (`clearOfflineMirror` from `@/lib/offline/db`) were statically imported but only used in the submit handler. Now `await import(...)` inside `handleSubmit` in `src/app/login/page.tsx`, `signup/page.tsx`, `forgot-password/page.tsx`, `reset-password/page.tsx`.
- [x] DONE (this session) **Middleware matcher**: now also excludes `manifest.webmanifest`, `sw.js`, and `api/cron` (`src/middleware.ts`). This was also a latent PWA bug: browsers fetch the manifest without credentials, so the middleware's `!user` branch was redirecting it to /login. Verify install prompt / manifest loads after deploy.
- [ ] **/feeds 196 kB (post-P1)**: remaining is feeds-nav (31 kB src) + article-list + article-reader all loaded upfront. CAUTION (investigated this session): `ArticleReader` mounts unconditionally in `feeds-shell.tsx` and owns the empty-state pane AND `useShortcuts` (j/k navigation works with nothing selected). Lazy-splitting it requires moving shortcuts + empty state up into feeds-shell first — medium effort, do behind manual smoke of keyboard nav.
- [ ] **knowledge-map.tsx (50 kB src)**: already route-isolated to /map (129 kB total) — fine. No action.
- [ ] **Images**: `next/image` used in feeds components; `images.remotePatterns` allows all https (needed for RSS). If deployed on Netlify, confirm image optimization isn't falling back to origin fetch per view (cost). Consider `unoptimized` for tiny feed favicons (they're already small; the optimizer round-trip may cost more than it saves).
- [ ] **React Compiler** (Next 15 `experimental.reactCompiler`): app has many hand-memoized client components; the compiler could auto-memoize the rest (feeds-nav, directory-nav re-renders). Needs `babel-plugin-react-compiler`, adds build time, and React 19 RC pin should be bumped to stable first. Medium effort, medium win.
- [ ] **React 19 RC pin**: `react@19.0.0-rc-66855b96-20241106` — upgrade to stable 19.x (perf fixes + removes RC risk). Do as its own PR with full regression pass.
- [ ] **DB**: schema indexes are comprehensive. Next lever is measuring: enable slow-query logging in Supabase and check the heavy aggregates (`fetchStudyStats`, gamify award path, map API) against real data volume. No blind index additions.
- [x] **Service worker** (`public/sw.js`) — stale `sb-static-v1` chunks purged this session: bumped `STATIC_CACHE` → `sb-static-v2`. On next `activate`, the old `sb-static-v1` name leaves the keep-set and is deleted wholesale (see the activate handler). Clears the current accumulation. **Limitation / follow-up:** this is a one-time purge per manual version bump, not automatic per deploy — for fully automatic purging on every build, inject `NEXT_BUILD_ID` into the SW (public files aren't webpack-processed, so it needs a small copy/replace step in the build pipeline). Left as storage-only, not speed, so non-blocking.
- [ ] **`optimizePackageImports`**: lucide-react is auto-optimized by Next 15 defaults. If adding more icon/util libs, add them to `experimental.optimizePackageImports` in `next.config.ts`.

## Constraints / gotchas for the next agent

- Source lives under `src/` (not root `app/`). Windows dev machine; paths with `(app)` need quoting in shells.
- `pdf-parse` is imported via `require("pdf-parse/lib/pdf-parse.js")` deliberately (serverless crash workaround) — don't "clean it up".
- `output: "standalone"` is gated behind `DESKTOP_BUILD` env — don't unconditionalize.
- Feeds infinite scroll: page query orderBy MUST stay in sync with `loadMoreArticlesAction` (id tiebreaker) — see comment in `src/app/(app)/feeds/page.tsx:87`.
- Study page uses `Promise.allSettled` deliberately (one failing panel must not blank the hub) — keep that pattern.
- Tests: `npm test` = vitest. Build: `npm run build` (Node v24 on this machine).
