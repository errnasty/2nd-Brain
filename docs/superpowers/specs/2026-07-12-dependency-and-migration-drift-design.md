# Dependency Remediation + Migration-Drift Guard — Design Spec

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement the plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remediate the supply-chain vulnerabilities that have a safe, non-breaking fix now, defer the major-version bumps to their own PRs, and convert the "migration drift" risk from a recurring foot-gun into a tested invariant so it can never silently reintroduce the desktop-sync hard-error.

**Architecture:** Two independent workstreams. (1) `npm audit fix` (non-`--force`) updates the lockfile/package.json for the patch-level advisories; correctness is proven by the existing green gates (`tsc --noEmit`, `eslint --max-warnings 0`, `vitest`, `next build`). (2) A new always-on vitest that parses `src/lib/sync/engine.ts` (the `TABLES` list) and asserts the local-desktop bootstrap (`src/lib/db/local-bootstrap.ts` + `src/lib/db/local-schema.ts`) creates every required table and its `updated_at` column — the exact condition the sync engine throws on at `engine.ts:171`. Plus doc corrections in `DEPLOY.md` (which currently instructs `npm run db:push` as the deploy path, the real drift source) and `IMPROVEMENT_HANDOVER.md`.

**Tech Stack:** npm 10 (audit), vitest, drizzle-orm (no schema changes), TypeScript, markdown docs.

## Global Constraints

- Source under `src/`; paths with `(app)` need shell quoting.
- Lint is `--max-warnings 0` — new intentionally-unused bindings must be `_`-prefixed; hook-dep exceptions need a justified eslint-disable line.
- In THIS sandbox `npm ci` fails on sharp's libvips download (proxy 403) — use `npm ci --legacy-peer-deps --ignore-scripts`; lint/tsc/tests/build all work without sharp binaries. GitHub Actions CI has open network and is fine.
- `supabase/policies.sql` must be re-run after ANY new table — it's the only thing standing between PostgREST and cross-user reads. (Informational; no new tables added here.)
- e2e: `npm run build` first, then `npm run test:e2e`.
- The AI budget module fails OPEN and is a no-op without `AI_DAILY_TOKEN_BUDGET`; `recordAiUsage` reuses `rate_limits.count` as a token accumulator — don't "fix" that column back to a request counter. (Informational.)
- **Dependency policy (owner-approved):** run the SAFE non-breaking `npm audit fix` only. The breaking-major `--force` bumps (`drizzle-orm 0.36→0.45.2`, `ai 4→7`, `@ai-sdk/*`, `@mozilla/readability 0.5→0.6`, `fast-xml-parser 4→5`) are DEFERRED to separate PRs each behind the full e2e suite. `protobufjs@6.11.6` is transitive via `@xenova/transformers` → `onnxruntime-web` → `onnx-proto` (in-browser ONNX model loading); npm's only "fix" is downgrading `@xenova/transformers` to a broken 2.0.1 — leave it. `next` must stay on 15.x (npm's `--force` path proposes a nonsensical `next@9.3.3` — never run that).

## Key investigation findings (ground truth before coding)

1. **Audit state (verified):** `npm audit` → 24 vulns (1 critical, 7 high, 10 moderate, 6 low).
   - Critical = `protobufjs@6.11.6` (transitive, not user-reachable from untrusted input; leave).
   - Safe non-`--force` fix clears: `form-data`, `js-yaml`, `undici`, `vite`, `esbuild` (+ their transitive descendants). These are patch/minor bumps.
   - Breaking `--force` bumps: `drizzle-orm`, `ai`/`@ai-sdk/*`, `@mozilla/readability`, `fast-xml-parser`. Each is a separate PR (deferred).
2. **Migration drift is misdiagnosed in the handover.** The canonical migrations are COMPLETE and idempotent at `supabase/migrations/0001`–`0019` (tsvector 0008, sync 0013, FSRS 0018, etc.). The cloud deploy uses them. `drizzle/` holds only `0000`/`0001` because it is the **desktop PGlite bundle source**, not the cloud deploy path.
3. **The real drift source = DEPLOY.md + `db:push`.** DEPLOY.md step 3 tells operators to run `npm run db:push` (`drizzle-kit push` against `schema.ts` alone), which creates core tables **without** the `supabase/migrations/` triggers/tsvector/sync-support/FSRS — a fresh deploy would silently lack sync support and break desktop sync at `engine.ts:171`.
4. **The desktop hard-error the handover cites is already handled.** `src/lib/db/local-bootstrap.ts` runs every desktop launch and idempotently applies `SYNC_SUPPORT_SQL` (adds `updated_at` to all 15 synced tables + `sync_tombstones`/`sync_meta`/`sync_conflicts` + touch/tombstone triggers, mirrors cloud 0013), plus `GAMIFY_SQL` (0016), `USER_SETTINGS_SQL` (0017), `RABBITHOLE_SQL` (0019), `FSRS_SQL` (0018), `PERF_INDEX_SQL` (0015). Its `touch_tables` array covers exactly the `TABLES` list `engine.ts` checks. So the fix is to **guard future drift**, not recover SQL.
5. **No automated CVE surfacing.** No Dependabot/Renovate, no scheduled `npm audit` job — the 24 advisories waited for a human to notice.

## Workstreams

### WS-A: Safe dependency remediation
- Run `npm audit fix` (no `--force`). Verify gate stays green.
- Add Dependabot (or Renovate) config: weekly, grouped PRs.
- Add a scheduled CI job: `npm audit --audit-level=high` (fails the job when ≥1 high/critical exists), so new CVEs surface without a human.
- Major bumps are explicitly NOT done here (separate PRs, deferred per owner).

### WS-B: Migration-drift guard (turn the foot-gun into a tested invariant)
- New vitest `src/lib/sync/__tests__/schema-drift.test.ts`:
  - Parse `TABLES` from `engine.ts` (regex over the exported `const TABLES: TableCfg[] = [...]` block): extract each `{ name: "..." }`.
  - Assert `local-schema.ts` (the generated DDL) creates each table OR `local-bootstrap.ts` creates it (GAMIFY/USER_SETTINGS/RABBITHOLE_SQL blocks).
  - Assert `local-bootstrap.ts`'s `SYNC_SUPPORT_SQL` adds `updated_at` to every `TABLES` name (the exact `:171` condition).
  - Assert `sync_tombstones`, `sync_meta`, `sync_conflicts` are created in `local-bootstrap.ts`.
  - This fails the build if anyone adds a synced table to `engine.ts`/`TABLES` without extending the local bootstrap — structurally preventing reintroduction of the `:171` hard-error.
- Correct `DEPLOY.md` step 3 + troubleshooting to use `supabase/migrations/` (the Supabase CLI `supabase db push`, or pasting files into the SQL Editor) instead of `drizzle-kit push`; document that `db:push` is local-dev-only and does NOT apply sync/FSRS/tsvector triggers.
- Re-point `drizzle/0001_search_trgm.sql` reference in DEPLOY.md to `supabase/migrations/0008_search_and_index_perf.sql` (the real trigram index) — note the README/DEPLOY mention of `drizzle/0001` should clarify it's the desktop bundle source.

### WS-C: Handover correction
- Update `IMPROVEMENT_HANDOVER.md` §0b and the roadmap §B to mark the migration-drift item resolved, and correct the misdiagnosis (migrations exist at `supabase/migrations/`; the real fix is guarding `db:push` + the bootstrap, not recovering SQL). Add a line to the §0 safe-fix result noting major bumps deferred to separate PRs.

## Testing

- `npx tsc --noEmit` clean.
- `npm run lint` (`eslint . --max-warnings 0`) passes.
- `npm test` (vitest) — 128 existing + the new `schema-drift.test.ts`.
- `npm run build` exit 0.
- (Deferred, separate PR) `npm run test:e2e` for the major dep bumps.

## Out of scope (explicitly deferred)

- `drizzle-orm 0.36→0.45.2` major bump (its own PR; audit all raw `db.execute(sql\`…\`)` sites).
- `ai 4→7` + `@ai-sdk/*` major bump.
- `@mozilla/readability 0.5→0.6`, `fast-xml-parser 4→5`.
- Touching `protobufjs` / `@xenova/transformers`.
- Authenticated e2e specs, CSP nonce round 2, email change, error monitoring, PWA share_target — separate roadmap items.
