# Dependency Remediation + Migration-Drift Guard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the safe, non-breaking `npm audit fix`; add automated CVE surfacing (Dependabot + audit CI job); add a tested invariant that the desktop local-bootstrap keeps the sync engine's `TABLES` list consistent (prevents the `engine.ts:171` hard-error from silently returning); correct the `db:push` foot-gun in `DEPLOY.md` and the stale §0b in `IMPROVEMENT_HANDOVER.md`.

**Architecture:** WS-A (deps) is a lockfile change gated by the existing green checks. WS-B (guard) is a new pure-logic vitest that parses the sync engine's `TABLES` and asserts the local bootstrap DDL covers every table + `updated_at` + the three sync cursor/conflict tables. WS-C (docs) corrects the deploy path and handover. No runtime/behavior change for users; the guard only adds a CI-time safety net.

**Tech Stack:** npm 10 audit, vitest, TypeScript, Supabase CLI (`supabase db push` as the documented deploy path), markdown.

## Global Constraints

- Source under `src/`; paths with `(app)` need shell quoting.
- Lint is `--max-warnings 0` — new intentionally-unused bindings must be `_`-prefixed; hook-dep exceptions need a justified eslint-disable line.
- In THIS sandbox `npm ci` fails on sharp's libvips download (proxy 403) — use `npm ci --legacy-peer-deps --ignore-scripts`; lint/tsc/tests/build all work without sharp binaries. GitHub Actions CI has open network and is fine.
- **Dependency policy (owner-approved):** run the SAFE non-breaking `npm audit fix` only. DEFER the breaking-major `--force` bumps (`drizzle-orm 0.36→0.45.2`, `ai 4→7`, `@ai-sdk/*`, `@mozilla/readability 0.5→0.6`, `fast-xml-parser 4→5`) to separate PRs each behind full e2e. LEAVE `protobufjs@6.11.6` (transitive via `@xenova/transformers`). NEVER run `npm audit fix --force` (proposes nonsensical `next@9.3.3`).
- `supabase/policies.sql` must be re-run after ANY new table (informational; no new tables added here).
- e2e: `npm run build` first, then `npm run test:e2e`.

---

### Task 1: Run safe non-breaking `npm audit fix`

**Files:**
- Modify: `package.json`, `package-lock.json` (produced by npm)
- Verify: `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run build`

**Interfaces:**
- Consumes: nothing
- Produces: updated lockfile with `form-data`, `js-yaml`, `undici`, `vite`, `esbuild` (+ transitive) on patched versions. NO major bumps.

- [ ] **Step 1: Capture pre-fix state**
  Run: `npm audit --audit-level=low | tail -3`
  Expected: `24 vulnerabilities (6 low, 10 moderate, 7 high, 1 critical)`

- [ ] **Step 2: Apply non-breaking fix only**
  Run: `npm audit fix`  (do NOT pass `--force`)
  Expected: exit 0; package.json `dependencies`/`devDependencies` NOT changed for `drizzle-orm`, `ai`, `@ai-sdk/*`, `@mozilla/readability`, `fast-xml-parser`, `@xenova/transformers`. Only patch/minor bumps applied.

- [ ] **Step 3: Verify no major bump slipped in**
  Run: `node -e "const w=['drizzle-orm','ai','@ai-sdk/anthropic','@ai-sdk/openai','@ai-sdk/react','@mozilla/readability','fast-xml-parser','@xenova/transformers','next']; for(const k of w){const d=require(k+'/package.json').version; console.log(k,d);}"`
  Expected: `drizzle-orm` still `0.36.x`, `ai` still `4.x`, `@mozilla/readability` still `0.5.x`, `fast-xml-parser` still `4.x`, `next` still `15.x`, `@xenova/transformers` still `2.17.2`.
  If any major changed → `git checkout package.json package-lock.json` and stop; report to user.

- [ ] **Step 4: Run the full green-gate**
  Run: `npx tsc --noEmit && npm run lint && npm test && npm run build`
  Expected: all four pass (build uses placeholder env: `NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=dummy DATABASE_URL=postgresql://x:***@localhost:5432/x npm run build`).

- [ ] **Step 5: Confirm remaining audit count dropped**
  Run: `npm audit --audit-level=low | tail -3`
  Expected: fewer than 24 (the safe set cleared); critical (`protobufjs`) still present by design.

- [ ] **Step 6: Commit**
  ```bash
  git add package.json package-lock.json
  git commit -m "deps: apply non-breaking npm audit fix (form-data/js-yaml/undici/vite/esbuild); majors deferred"
  ```

---

### Task 2: Add automated CVE surfacing (Dependabot + audit CI job)

**Files:**
- Create: `.github/dependabot.yml`
- Modify: `.github/workflows/ci.yml` (add `audit` job)

**Interfaces:**
- Consumes: nothing
- Produces: a weekly grouped dependency-update source + a CI job that fails on ≥1 high/critical advisory.

- [ ] **Step 1: Write Dependabot config**
  Create `.github/dependabot.yml`:
  ```yaml
  version: 2
  updates:
    - package-ecosystem: "npm"
      directory: "/"
      schedule:
        interval: "weekly"
      open-pull-requests-limit: 10
      groups:
        patch-minor:
          update-types: ["patch", "minor"]
        majors:
          update-types: ["version-update:semver-major"]
    - package-ecosystem: "github-actions"
      directory: "/"
      schedule:
        interval: "weekly"
  ```

- [ ] **Step 2: Add audit job to ci.yml**
  Insert a new job after `check:` (same `runs-on`, `actions/checkout@v4`, `actions/setup-node@v4`, `npm ci --legacy-peer-deps`):
  ```yaml
    audit:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-node@v4
          with:
            node-version: 20
            cache: npm
        - run: npm ci --legacy-peer-deps
        - name: Audit (fail on high/critical)
          run: npm audit --audit-level=high
  ```
  NOTE: because the safe set is cleared in Task 1, this job will pass (only the critical `protobufjs`, transitive + not user-reachable, remains, which is below `high`). If it fails, inspect and report — do not bypass.

- [ ] **Step 3: Validate YAML parses**
  Run: `node -e "try{require('fs').readFileSync('.github/dependabot.yml');require('fs').readFileSync('.github/workflows/ci.yml');console.log('files exist')}catch(e){console.log(e.message)}"`
  Expected: `files exist`.

- [ ] **Step 4: Commit**
  ```bash
  git add .github/dependabot.yml .github/workflows/ci.yml
  git commit -m "ci: add Dependabot (weekly grouped) + npm audit --audit-level=high job"
  ```

---

### Task 3: Add migration-drift guard test

**Files:**
- Create: `src/lib/sync/__tests__/schema-drift.test.ts`
- (Read-only assertions against) `src/lib/sync/engine.ts`, `src/lib/db/local-bootstrap.ts`, `src/lib/db/local-schema.ts`

**Interfaces:**
- Consumes: file contents of `engine.ts` (the `TABLES` array), `local-bootstrap.ts` (`SYNC_SUPPORT_SQL` + `GAMIFY_SQL`/`USER_SETTINGS_SQL`/`RABBITHOLE_SQL` blocks), `local-schema.ts` (`LOCAL_SCHEMA_SQL`).
- Produces: a vitest module that fails the suite if (a) a `TABLES` table is missing from the local DDL, (b) any `TABLES` table lacks an `updated_at` add in `SYNC_SUPPORT_SQL`, or (c) `sync_tombstones`/`sync_meta`/`sync_conflicts` are absent.

- [ ] **Step 1: Write the failing test**
  Create `src/lib/sync/__tests__/schema-drift.test.ts`:
  ```ts
  import { readFileSync } from "node:fs";
  import { fileURLToPath } from "node:url";
  import { dirname, resolve } from "node:path";

  const here = dirname(fileURLToPath(import.meta.url));
  const repo = resolve(here, "..", "..", "..", "..");

  const engineSrc = readFileSync(resolve(repo, "src/lib/sync/engine.ts"), "utf8");
  const bootstrapSrc = readFileSync(resolve(repo, "src/lib/db/local-bootstrap.ts"), "utf8");
  const localSchemaSrc = readFileSync(resolve(repo, "src/lib/db/local-schema.ts"), "utf8");

  // Tables the SYNC ENGINE expects to exist locally (engine.ts: TABLES).
  function tablesFromEngine(): string[] {
    const m = engineSrc.match(/const TABLES:\s*TableCfg\[\]\s*=\s*\[([\s\S]*?)\n\];/);
    if (!m) throw new Error("Could not find TABLES in engine.ts");
    const body = m[1];
    const names: string[] = [];
    const re = /name:\s*"([a-z_]+)"/g;
    let mm: RegExpExecArray | null;
    while ((mm = re.exec(body))) names.push(mm[1]);
    return names;
  }

  describe("desktop local-schema stays in sync with the sync engine's TABLES", () => {
    const tables = tablesFromEngine();
    const createStmts = (bootstrapSrc + "\n" + localSchemaSrc).toLowerCase();

    it("covers every synced table with a CREATE TABLE", () => {
      for (const t of tables) {
        const ok =
          createStmts.includes(`create table if not exists "${t}"`) ||
          createStmts.includes(`create table "${t}"`) ||
          createStmts.includes(`create table if not exists ${t}`);
        expect(ok, `table ${t} (in engine.ts TABLES) is missing from local-bootstrap/local-schema`).toBe(true);
      }
    });

    it("adds updated_at to every synced table (sync engine throws at engine.ts:171 without it)", () => {
      for (const t of tables) {
        const has = new RegExp(`alter table ${t}\\s+add column if not exists updated_at`, "i").test(bootstrapSrc);
        expect(has, `SYNC_SUPPORT_SQL must add updated_at to ${t}`).toBe(true);
      }
    });

    it("creates the sync cursor + conflict tables", () => {
      expect(bootstrapSrc.includes("create table if not exists sync_tombstones")).toBe(true);
      expect(bootstrapSrc.includes("create table if not exists sync_meta")).toBe(true);
      expect(bootstrapSrc.includes("create table if not exists sync_conflicts")).toBe(true);
    });
  });
  ```
  NOTE: the repo uses `vitest`; `scripts/vitest.mjs` runs `src/**`. `import.meta.url` is available under the existing vitest config. Confirm the new file is picked up.

- [ ] **Step 2: Run the test to verify it passes (invariant already holds)**
  Run: `node scripts/vitest.mjs run src/lib/sync/__tests__/schema-drift.test.ts`
  Expected: PASS (because `local-bootstrap.ts` already mirrors all migrations). If it FAILS, stop — the invariant is broken for real; report and do NOT paper over it.

- [ ] **Step 3: Sanity-check the regex extracts the real table list**
  Run: `node -e "const s=require('fs').readFileSync('src/lib/sync/engine.ts','utf8');const m=s.match(/const TABLES:\s*TableCfg\[\]\s*=\s*\[([\s\S]*?)\n\];/);const b=m[1];const re=/name:\s*\"([a-z_]+)\"/g;let x;const n=[];while((x=re.exec(b)))n.push(x[1]);console.log('count',n.length);console.log(n.join(','))"`
  Expected: prints the real TABLES names (should include profiles, folders, feeds, tags, articles, documents, document_chunks, directory_folders, directory_items, item_tags, directory_flashcards, rabbithole_nodes, player_profile, skills, user_settings, and any others). If count is 0, the regex in the test must match engine.ts's actual formatting — adjust.

- [ ] **Step 4: Commit**
  ```bash
  git add src/lib/sync/__tests__/schema-drift.test.ts
  git commit -m "test: guard desktop local-schema against sync-engine TABLES drift (engine.ts:171)"
  ```

---

### Task 4: Correct the `db:push` foot-gun in DEPLOY.md

**Files:**
- Modify: `DEPLOY.md` (step 3 + troubleshooting + the `drizzle/0001` reference)

**Interfaces:**
- Consumes: knowledge that `supabase/migrations/0001`–`0019` is canonical; `drizzle/` is the desktop-bundle source only.
- Produces: corrected deploy instructions that apply the full schema (incl. sync/FSRS/tsvector triggers) via `supabase db push` or SQL-Editor paste.

- [ ] **Step 1: Replace step 3 schema-push instructions**
  In `DEPLOY.md`, replace the block (the "## 3. Push the schema + RLS" section) that says run `npm run db:push` with guidance to use the Supabase migration set. New wording for the push paragraph:
  ```
  The schema lives as versioned, idempotent migrations in `supabase/migrations/`
  (0001–0019: tables, `updated_at` + sync triggers, tsvector search, FSRS,
  gamification, user settings, rabbitholes). Apply them with the Supabase CLI:

      supabase db push

  (or, in the Supabase **SQL Editor**, paste each `supabase/migrations/00NN_*.sql`
  file in order and run them). This is the ONLY path that creates the sync
  support / FSRS / tsvector triggers the app needs.

  > NOTE: Do NOT use `npm run db:push` (`drizzle-kit push`) for a real deploy.
  > It generates a schema from `drizzle/` — the DESKTOP PGlite bundle source
  > only — and omits every `supabase/migrations/` trigger. A fresh cloud DB
  > built that way would silently lack sync support and break desktop sync.
  > `drizzle/` is used solely to bundle the embedded desktop database.
  ```
  Keep the existing RLS + trigram-index paragraph but point the trigram SQL at `supabase/migrations/0008_search_and_index_perf.sql` (not `drizzle/0001_search_trgm.sql`).

- [ ] **Step 2: Fix the "wipe the DB" recovery note + troubleshooting line + connection-type note**
  - The "If you ever wipe the DB" note: change `npm run db:push` → `supabase db push`.
  - The troubleshooting `DATABASE_URL is required` line: reword "during `npm run db:push`" → "during `supabase db push`".
  - The connection-type note "use during `npm run db:push`" → "use during `supabase db push`".

- [ ] **Step 3: Verify no stray `npm run db:push` deploy guidance remains**
  Search the file for `db:push`; every remaining mention must be clearly "local-dev-only / not for deploy" or removed. (The `package.json` script itself stays — valid local-dev tool; just don't document it as the deploy path.)

- [ ] **Step 4: Commit**
  ```bash
  git add DEPLOY.md
  git commit -m "docs(DEPLOY): use supabase/migrations as the canonical deploy schema; mark db:push as local-dev-only"
  ```

---

### Task 5: Correct IMPROVEMENT_HANDOVER.md §0b / roadmap §B

**Files:**
- Modify: `IMPROVEMENT_HANDOVER.md`

**Interfaces:**
- Consumes: the verified finding that migrations exist complete at `supabase/migrations/0001`–`0019` and `local-bootstrap.ts` already mirrors them.
- Produces: an updated handover that marks the drift item resolved and prevents the next session from re-chasing it.

- [ ] **Step 1: Add a "pass 4" shipped section**
  Insert after the last shipped item (pass 3, item 16) a new block:
  ```
  ## Shipped — pass 4 (dependency + migration-drift remediation)
  17. **Safe dependency remediation** — non-breaking `npm audit fix` applied
      (form-data, js-yaml, undici, vite, esbuild patch/minor bumps); 24→fewer
      vulns. Major `--force` bumps (drizzle-orm 0.36→0.45.2, ai 4→7,
      @mozilla/readability 0.5→0.6, fast-xml-parser 4→5) deferred to separate
      PRs each behind full e2e; `protobufjs` (transitive via @xenova/transformers)
      left as-is. Added Dependabot (weekly grouped) + `npm audit
      --audit-level=high` CI job.
  18. **Migration-drift guard** — the handover's §0b misdiagnosed the drift:
      the canonical migrations are COMPLETE and idempotent at
      `supabase/migrations/0001`–`0019`; `drizzle/` is only the desktop PGlite
      bundle source, and `src/lib/db/local-bootstrap.ts` already mirrors every
      cloud migration (sync 0013, FSRS 0018, gamify 0016, settings 0017,
      rabbithole 0019) on every desktop launch. Added
      `src/lib/sync/__tests__/schema-drift.test.ts` asserting the local
      bootstrap covers every `engine.ts` TABLES entry + updated_at + sync
      cursor/conflict tables, so the `:171` hard-error can't silently return.
      Fixed the REAL drift source: `DEPLOY.md` previously told operators to
      `npm run db:push` (omits all cloud triggers) — now documents
      `supabase db push` as canonical.
  ```

- [ ] **Step 2: Update §0b text**
  In the §0 "Two urgent finds" block, change the migration-drift bullet to:
  ```
  - **Migration drift — RESOLVED (was misdiagnosed).** The migrations exist
    complete and idempotent at `supabase/migrations/0001`–`0019`; `drizzle/` is
    the desktop bundle source only, and `local-bootstrap.ts` mirrors every cloud
    migration on desktop launch. The real risk was `DEPLOY.md` instructing
    `npm run db:push` (a cloud DB created this way lacks sync/FSRS/tsvector
    triggers). Fixed in pass 4 (DEPLOY.md → `supabase db push`; added drift
    guard test). No SQL recovery needed.
  ```

- [ ] **Step 3: Add a backlog §B note**
  In backlog §B, prepend: `(Resolved in pass 4 — see Shipped item 18. The drift was documentation/guard, not missing SQL. No recovery from live DB required.)`

- [ ] **Step 4: Commit**
  ```bash
  git add IMPROVEMENT_HANDOVER.md
  git commit -m "docs(handover): mark migration-drift resolved (was misdiagnosed); record pass-4 dependency + guard work"
  ```

---

### Task 6: Final full verification

**Files:** none new
**Interfaces:** re-runs all gates.

- [ ] **Step 1: Type-check + lint + tests + build**
  Run: `npx tsc --noEmit && npm run lint && npm test && npm run build`
  Expected: all green. `npm test` output should show `129` passed (128 + schema-drift).

- [ ] **Step 2: Audit residual**
  Run: `npm audit --audit-level=high | tail -3`
  Expected: `0 vulnerabilities` (or only the critical `protobufjs`, which is below `high` and acceptable by design). If `high`/`critical` remain besides `protobufjs`, investigate before declaring done.

- [ ] **Step 3: Diff sanity**
  Run: `git log --oneline -6`
  Expected: 5 commits (Tasks 1–5), each scoped. No `drizzle-orm`/`ai`/`next` major version change in `package.json`.

- [ ] **Step 4: Report to user**
  Summarize: safe-fix applied + count, Dependabot + audit job added, guard test added (129 tests), DEPLOY.md + handover corrected, and the explicit deferral list (major bumps) for separate PRs.
