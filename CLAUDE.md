## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

## Changelog (user-facing "What's New")

The app shows users what changed since their last visit, sourced from `src/data/changelog.ts` (newest first). The newest entry's `id` is the watermark that drives the in-app "What's New" panel (`LATEST_CHANGELOG_ID`).

Before committing a **user-facing** change — a new feature, a visible behavior/UX change, or a notable fix — PREPEND a `ChangelogEntry` to `src/data/changelog.ts`:
- `id`: today's date, `"YYYY-MM-DD"` (append a letter suffix like `-a`/`-b` for multiple same-day entries so ids stay unique and sortable).
- `date`: human display date, e.g. `"July 13, 2026"`.
- `tag`: `"feature"`, `"improvement"`, or `"fix"`.
- `title` + `summary` (1–2 sentences) in plain, user-facing language — **no file paths, code, or internal jargon**. Optional `items` for bullets.

Purely internal work (refactors, tests, infra, dependency bumps, perf with no visible change) can be skipped. Keep `AGENTS.md` and `CLAUDE.md` identical.
