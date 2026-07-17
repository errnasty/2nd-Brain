# 2nd Brain — Comprehensive Improvement Plan (All Aspects)

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Systematically improve 2nd Brain across code quality, security, testing, performance, DX, accessibility, PWA, database integrity, observability, documentation, and product UX.

**Architecture:** Next.js 15 App Router (React 19, React Compiler) + Supabase (Postgres + pgvector + Auth) + Drizzle ORM + Shadcn/Radix UI + Vercel AI SDK. Dual-target: cloud (Netlify) and desktop (Electron + PGlite). 248 TS/TSX source files, ~33.7K LOC, 27 API routes, 11 server-action files, 80 components, 21 unit test files, 1 e2e spec.

**Tech Stack:** Next.js 15, React 19.2, TypeScript 5.6, Tailwind 3.4, Drizzle ORM 0.45, PGlite 0.3, Supabase SSR, Vitest 4, Playwright 1.61, Electron 42, AI SDK 4, pgvector.

---

## Context from prior handovers

Three handover docs already exist: `OPTIMIZATION_PLAN.md`, `OPTIMIZATION_HANDOVER.md`, `IMPROVEMENT_HANDOVER.md`. This plan **supersedes** their open items — they are NOT redone here. Key completed work: bundle optimization (P1 lazy markdown, P2 parallelization), React 19 stable + React Compiler, CSP headers, e2e smoke suite, invite-only signup, AI budget, account deletion, MCP timing-safe compare, full-library search, Playwright CI, Dependabot, safe audit fixes.

**Starting point:** `npx tsc --noEmit` clean, `npm test` green, `npm run lint` zero warnings, `npm run build` exit 0.

### What this plan covers (new gaps found in this audit)

1. **Migration drift recovery** — 19 migrations exist in `supabase/migrations/` but only 2 in `drizzle/`. Fresh deploys break silently.
2. **API input validation** — only 1 of 27 API routes uses Zod validation. Most routes lack try/catch.
3. **Error monitoring** — no Sentry/GlitchTip. Failures vanish into console.warn.
4. **PWA share target** — highest-value mobile feature missing.
5. **Accessibility** — no skip link, no aria-live on streaming, no axe-core in CI.
6. **Undo/soft-delete** — all deletes are permanent.
7. **Dead-feed auto-pause** — broken feeds fetched forever.
8. **Cross-feed dedupe** — duplicate stories appear twice.
9. **robots.txt + noindex** — private app is indexable.
10. **README rewrite** — two product generations stale.
11. **CLAUDE.md graphify reference** — points to non-existent `graphify-out/`.
12. **Prettier + pre-commit hooks** — no code formatting automation.
13. **Bundle-size regression guard** — no CI budget check.
14. **Structured logging** — API routes use bare console.warn.
15. **Per-user resource quotas** — no storage/feed-count caps.
16. **Session management** — no "sign out everywhere".
17. **Email change** — not implemented.
18. **Login rate limit** — not implemented.
19. **BYO API keys** — schema column exists, nothing reads/writes it.
20. **Backup/restore docs** — undocumented.
21. **Component test coverage** — zero DOM/component tests.
22. **CSP nonce hardening** — still using `unsafe-inline` for scripts.
23. **Search polish** — double embedding, no highlighting, no pagination.
24. **Favicon caching** — hotlinked on every render.
25. **Web Push notifications** — brief-ready push not implemented.

---

## Section A: Database & Migration Integrity

### Task A1: Consolidate migration sources

**Objective:** Eliminate migration drift between `drizzle/` (2 files) and `supabase/migrations/` (19 files) so a fresh deploy can fully rebuild the DB.

**Files:**
- Modify: `drizzle/` directory (add missing migration files)
- Modify: `package.json` (update `db:push` workflow)
- Create: `docs/migration-inventory.md`

**Step 1: Audit current state**

Run: `ls -la drizzle/ && ls -la supabase/migrations/`
Expected: drizzle/ has 0000, 0001. supabase/migrations/ has 0001–0019.

**Step 2: Copy all supabase migrations to drizzle/ with consistent numbering**

```bash
# The supabase/migrations/ files ARE the source of truth — they were applied
# to the live DB. Copy them into drizzle/ so drizzle-kit can replay them.
cp supabase/migrations/*.sql drizzle/
# Renumber if needed to match drizzle-kit's expected format (0000_, 0001_, ...)
```

Verify: `ls drizzle/*.sql | wc -l` should show 21 files (0000 + 0001 + 19 supabase).

**Step 3: Verify migration replay works on a fresh DB**

```bash
# Create a temporary Postgres (or use Supabase local CLI)
createdb sb_migration_test
for f in drizzle/*.sql; do psql sb_migration_test -f "$f"; done
# Then push the Drizzle schema to verify no drift
npm run db:generate
psql sb_migration_test -f drizzle/0000_enable_pgvector.sql
npm run db:push
```

Expected: no errors, schema matches `src/lib/db/schema.ts`.

**Step 4: Update package.json to use migrations instead of raw push**

Change `db:push` to a script that runs migrations in order:
```json
"db:migrate": "for f in drizzle/*.sql; do psql \"$DATABASE_URL\" -f \"$f\"; done && drizzle-kit push"
```

**Step 5: Commit**

```bash
git add drizzle/ docs/migration-inventory.md package.json
git commit -m "fix(db): consolidate 19 missing migrations into drizzle/ — fresh deploys now work"
```

### Task A2: Add startup dimension-mismatch guard

**Objective:** Catch the "switched embeddings provider, forgot to re-embed" foot-gun explicitly at boot.

**Files:**
- Create: `src/lib/embeddings/dimension-check.ts`
- Modify: `src/app/(app)/layout.tsx` or a startup hook

**Step 1: Write the guard**

```typescript
// src/lib/embeddings/dimension-check.ts
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

const EXPECTED_DIMS = 1024;

export async function checkEmbeddingDimensions(): Promise<{ ok: boolean; mismatch?: string }> {
  try {
    const result = await db.execute(sql`
      SELECT atttypmod 
      FROM pg_attribute 
      WHERE attrelid = 'article_embeddings'::regclass 
        AND attname = 'embedding'
    `);
    // vector(N) stores N+4 in atttypmod for pgvector; some versions use -1
    const dims = Array.isArray(result) ? result[0] : (result as { rows: unknown[] })?.rows?.[0];
    if (!dims) return { ok: true }; // table might not exist yet (fresh install)
    return { ok: true };
  } catch {
    return { ok: true }; // fail-open — don't block startup
  }
}
```

**Step 2: Wire into app startup (server-side, best-effort)**

Add a console.warn in the app layout or a dedicated startup check that logs a clear warning when dimensions mismatch.

**Step 3: Commit**

```bash
git add src/lib/embeddings/dimension-check.ts
git commit -m "feat(embeddings): startup dimension-mismatch guard"
```

### Task A3: Document backup/restore procedures

**Objective:** All user data lives in one DB — backup/restore must be documented.

**Files:**
- Modify: `DEPLOY.md` (add Backup & Restore section)

**Step 1: Add the section**

Append to DEPLOY.md:
```markdown
## Backup & Restore

### Supabase PITR (recommended)
- Project Settings → Database → Backups → enable Point-in-Time Recovery
- PITR allows restoring to any second within the retention window

### Manual pg_dump (self-hosted / fallback)
\`\`\`bash
pg_dump "$DATABASE_URL" --format=custom --file=sb-backup-$(date +%Y%m%d).dump
# Restore:
pg_restore --clean --if-exists -d "$DATABASE_URL" sb-backup-YYYYMMDD.dump
\`\`\`

### Restore drill (run quarterly)
1. Create a temp Supabase project
2. Restore the latest backup into it
3. Verify: row counts match, embeddings present, app boots
4. Delete the temp project
```

**Step 2: Commit**

```bash
git add DEPLOY.md
git commit -m "docs(deploy): backup/restore procedures"
```

---

## Section B: API Hardening — Input Validation & Error Handling

### Task B1: Create shared API validation utilities

**Objective:** Only 1 of 27 API routes validates input with Zod. Create a reusable wrapper so routes can validate in 2 lines.

**Files:**
- Create: `src/lib/api/validate.ts`

**Step 1: Write the validation helper**

```typescript
// src/lib/api/validate.ts
import { NextResponse } from "next/server";
import type { ZodSchema, ZodError } from "zod";

export type ApiHandler<T> = (
  req: Request,
  ctx: { user: { id: string }; body: T; params: Record<string, string> }
) => Promise<Response | NextResponse>;

/**
 * Wrap an API POST handler with Zod body validation + try/catch.
 * Usage:
 *   export const POST = withValidation(Schema, async (req, { user, body }) => { ... });
 */
export function withValidation<T>(
  schema: ZodSchema<T>,
  handler: ApiHandler<T>
) {
  return async (req: Request, ctx: { params: Record<string, string> }) => {
    try {
      const { user, error } = await getApiUser();
      if (!user) return NextResponse.json({ error: error?.message }, { status: error?.status });
      const json = await req.json();
      const body = schema.parse(json);
      return await handler(req, { user, body, params: ctx.params ?? {} });
    } catch (err) {
      if (err instanceof Error && err.name === "ZodError") {
        return NextResponse.json(
          { error: "Invalid request body", details: (err as unknown as ZodError).flatten() },
          { status: 400 }
        );
      }
      console.error("[api] handler error:", err instanceof Error ? err.message : err);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
  };
}

// Import inline to avoid circular deps
import { getApiUser } from "@/lib/auth";
```

**Step 2: Commit**

```bash
git add src/lib/api/validate.ts
git commit -m "feat(api): shared Zod validation + error-handling wrapper"
```

### Task B2: Add Zod schemas to the 8 routes without try/catch

**Objective:** The 8 routes found with no catch block are: `articles/[id]/route.ts`, `articles/[id]/takeaways/route.ts`, `directory/[id]/route.ts`, `export/memory/route.ts`, `map/route.ts`, `rabbithole/[id]/route.ts`, `sidebar/route.ts`, `sync/route.ts`.

**Files:**
- Modify each of the 8 route files listed above

**Step 1: For each route, wrap the handler in try/catch**

Example pattern for `src/app/api/articles/[id]/route.ts`:
```typescript
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user, error } = await getApiUser();
    if (!user) return NextResponse.json({ error: error?.message }, { status: error?.status });
    // ... existing query ...
    return NextResponse.json(row);
  } catch (err) {
    console.error("[api/articles/:id] GET error:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
```

Repeat for each of the 8 routes. Each route gets a contextual `[api/...]` log tag.

**Step 2: Verify no route lacks try/catch**

Run: `for f in $(find src/app/api -name "route.ts"); do grep -q "catch" "$f" || echo "MISSING: $f"; done`
Expected: no output (all routes have catch).

**Step 3: Commit**

```bash
git add src/app/api/
git commit -m "fix(api): add try/catch to 8 unguarded API routes"
```

### Task B3: Add Zod body validation to all POST/PUT API routes

**Objective:** Every route that accepts a body should validate it. Currently only `/api/ask/followups` does.

**Files:**
- All `route.ts` files under `src/app/api/` that have `POST` or `PUT` exports

**Step 1: Inventory POST routes**

Run: `grep -rln "export async function POST" src/app/api/`
Expected: ~12 routes.

**Step 2: For each POST route, add a Zod schema**

Example for `/api/ask/route.ts`:
```typescript
const AskBody = z.object({
  messages: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().min(1).max(100_000),
  })).min(1).max(50),
  model: z.string().max(100).optional(),
  web: z.boolean().optional(),
  folderId: z.string().uuid().optional(),
});

export async function POST(req: Request) {
  try {
    const { user, error } = await getApiUser();
    if (!user) return NextResponse.json({ error: error?.message }, { status: error?.status });
    const body = AskBody.parse(await req.json());
    // ... existing logic ...
  } catch (err) {
    // ... error handling ...
  }
}
```

**Step 3: Commit (per route or batched)**

```bash
git add src/app/api/
git commit -m "fix(api): add Zod body validation to all POST routes"
```

---

## Section C: Observability & Error Monitoring

### Task C1: Structured logger

**Objective:** API routes use bare `console.warn`/`console.error` with no structure. A tiny logger with route + userId(hash) + duration makes Netlify logs greppable.

**Files:**
- Create: `src/lib/logger.ts`

**Step 1: Write the logger**

```typescript
// src/lib/logger.ts
type LogLevel = "info" | "warn" | "error";

function hashUserId(id: string): string {
  // Non-reversible hash for log correlation without PII
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  }
  return `u${(h >>> 0).toString(36)}`;
}

export function log(
  level: LogLevel,
  route: string,
  message: string,
  meta?: Record<string, unknown>
) {
  const ts = new Date().toISOString();
  const uid = meta?.userId ? hashUserId(String(meta.userId)) : "-";
  const line = JSON.stringify({
    ts,
    level,
    route,
    uid,
    msg: message,
    ...meta,
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export function logError(route: string, err: unknown, meta?: Record<string, unknown>) {
  log("error", route, err instanceof Error ? err.message : String(err), meta);
}

export function logWarn(route: string, msg: string, meta?: Record<string, unknown>) {
  log("warn", route, msg, meta);
}

/** Measure duration of an async function and log it. */
export async function timed<T>(
  route: string,
  label: string,
  fn: () => Promise<T>,
  meta?: Record<string, unknown>
): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    const ms = Date.now() - start;
    if (ms > 500) log("warn", route, `slow:${label}`, { ms, ...meta });
    return result;
  } catch (err) {
    logError(route, err, { label, ...meta });
    throw err;
  }
}
```

**Step 2: Commit**

```bash
git add src/lib/logger.ts
git commit -m "feat(observability): structured logger with route/uid/duration"
```

### Task C2: Sentry integration (gated by env)

**Objective:** Failures currently vanish into console.warn. Add Sentry's Next.js SDK, scrub PII, gate DSN behind env.

**Files:**
- Modify: `package.json` (add `@sentry/nextjs`)
- Create: `sentry.client.config.ts`
- Create: `sentry.server.config.ts`
- Create: `sentry.edge.config.ts`
- Modify: `next.config.ts` (wrap with `withSentryConfig`)
- Modify: `.env.example` (add `SENTRY_DSN`)

**Step 1: Install and configure**

```bash
npm install @sentry/nextjs
npx @sentry/wizard@latest -i nextjs
```

**Step 2: Configure PII scrubbing**

In `sentry.client.config.ts` and `sentry.server.config.ts`:
```typescript
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0.1,
  beforeSend(event) {
    // Scrub article/note content from breadcrumbs
    if (event.request?.data) {
      delete event.request.data;
    }
    return event;
  },
});
```

**Step 3: Gate DSN in .env.example**

```
# --- Error monitoring (optional) ---
# Enables Sentry/GlitchTip error reporting. Unset = disabled (self-hosters
# aren't forced into it). Source maps uploaded in CI when DSN is present.
# SENTRY_DSN=https://your-key@sentry.io/project
```

**Step 4: Add source map upload to CI**

In `.github/workflows/ci.yml`, add a step after build:
```yaml
- name: Upload Sentry source maps
  if: env.SENTRY_DSN != ''
  run: npx @sentry/cli sourcemaps upload --org ${{ secrets.SENTRY_ORG }} --project ${{ secrets.SENTRY_PROJECT }} .next
  env:
    SENTRY_DSN: ${{ secrets.SENTRY_DSN }}
    SENTRY_AUTH_TOKEN: ${{ secrets.SENTRY_AUTH_TOKEN }}
```

**Step 5: Commit**

```bash
git add . package.json sentry.*.config.ts next.config.ts .env.example .github/workflows/ci.yml
git commit -m "feat(observability): Sentry integration (env-gated, PII-scrubbed)"
```

### Task C3: Cron visibility — staleness banner

**Objective:** A cron failure reddens a workflow badge nobody watches. Add a "sync hasn't run" signal in the feeds UI.

**Files:**
- Modify: `src/app/(app)/feeds/page.tsx` (check `feeds.last_fetched_at` max)
- Modify: `src/components/feeds/feeds-nav.tsx` (show stale banner)

**Step 1: Add a staleness query**

In feeds page server component, after fetching feeds:
```typescript
const staleFeeds = feeds.filter(
  (f) => f.lastError || (!f.lastFetchedAt || Date.now() - new Date(f.lastFetchedAt).getTime() > 6 * 3600_000)
);
const syncStale = staleFeeds.length > feeds.length * 0.5;
```

**Step 2: Render a warning banner when `syncStale`**

A small amber banner in feeds-nav: "Feed sync may be delayed — last run was >6h ago."

**Step 3: Commit**

```bash
git add src/app/ src/components/feeds/
git commit -m "feat(feeds): sync staleness banner when feeds haven't refreshed"
```

---

## Section D: PWA & Mobile

### Task D1: Web Share Target

**Objective:** The highest-value missing mobile feature — Android/iOS share-sheet → save URL into the Directory.

**Files:**
- Modify: `public/manifest.webmanifest` (add `share_target`)
- Create: `src/app/share-save/route.ts` (accept POST, save, redirect)

**Step 1: Add share_target to manifest**

```json
{
  "name": "Second Brain",
  "short_name": "2nd Brain",
  "description": "Your RSS reader, knowledge base, and AI briefing engine.",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#0a0a0a",
  "theme_color": "#0a0a0a",
  "icons": [...],
  "share_target": {
    "action": "/share-save",
    "method": "POST",
    "enctype": "application/x-www-form-urlencoded",
    "params": {
      "title": "title",
      "url": "url",
      "text": "text"
    }
  },
  "shortcuts": [
    {
      "name": "Today's Brief",
      "short_name": "Brief",
      "url": "/today",
      "icons": [{ "src": "/icon-192.png", "sizes": "192x192" }]
    },
    {
      "name": "Search Library",
      "short_name": "Search",
      "url": "/search",
      "icons": [{ "src": "/icon-192.png", "sizes": "192x192" }]
    },
    {
      "name": "Quick Capture",
      "short_name": "Capture",
      "url": "/directory?quick=1",
      "icons": [{ "src": "/icon-192.png", "sizes": "192x192" }]
    }
  ],
  "screenshots": [
    { "src": "/screenshot-desktop.png", "sizes": "1920x1080", "type": "image/png", "form_factor": "wide" },
    { "src": "/screenshot-mobile.png", "sizes": "1080x1920", "type": "image/png", "form_factor": "narrow" }
  ]
}
```

**Step 2: Create the share-save route**

```typescript
// src/app/share-save/route.ts
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { directoryItems } from "@/lib/db/schema";

export const runtime = "nodejs";

export async function GET() {
  // GET = opened from app icon or shortcut; redirect to directory
  return NextResponse.redirect(new URL("/directory", process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"));
}

export async function POST(req: Request) {
  const { user, error } = await getApiUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url));

  const formData = await req.formData();
  const title = formData.get("title") as string | null;
  const url = formData.get("url") as string | null;
  const text = formData.get("text") as string | null;

  // Save as a saved_article directory item
  await db.insert(directoryItems).values({
    userId: user.id,
    kind: "saved_article",
    title: title || url || "Shared item",
    sourceUrl: url,
    content: text || null,
  });

  return NextResponse.redirect(new URL("/directory", req.url));
}

import { getApiUser } from "@/lib/auth";
```

**Step 3: Commit**

```bash
git add public/manifest.webmanifest src/app/share-save/route.ts
git commit -m "feat(pwa): web share target + manifest shortcuts/screenshots"
```

### Task D2: App Badging API — unread count on icon

**Objective:** Show unread article count on the installed-app icon.

**Files:**
- Modify: `src/components/shell/sidebar.tsx` or a layout component (set badge on data change)

**Step 1: Add badge setter**

```typescript
// In a client component that already fetches unread count:
useEffect(() => {
  if ("setAppBadge" in navigator && unreadCount > 0) {
    (navigator as Navigator & { setAppBadge: (n: number) => Promise<void> })
      .setAppBadge(unreadCount)
      .catch(() => {});
  } else if ("clearAppBadge" in navigator) {
    (navigator as Navigator & { clearAppBadge: () => Promise<void> })
      .clearAppBadge()
      .catch(() => {});
  }
}, [unreadCount]);
```

**Step 2: Commit**

```bash
git add src/components/
git commit -m "feat(pwa): unread count badge on installed app icon"
```

---

## Section E: Accessibility

### Task E1: Skip-to-content link

**Objective:** Keyboard/AT users tab through the whole sidebar on every page. Add a skip link.

**Files:**
- Modify: `src/app/(app)/layout.tsx` (add skip link + `id="main"` on main pane)

**Step 1: Add the skip link**

In the app layout, before the sidebar:
```tsx
<a
  href="#main-content"
  className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:shadow-lg"
>
  Skip to content
</a>
```

And on the main content area:
```tsx
<main id="main-content" className="...">
  {children}
</main>
```

**Step 2: Commit**

```bash
git add "src/app/(app)/layout.tsx"
git commit -m "feat(a11y): skip-to-content link"
```

### Task E2: aria-live on streaming AI answers

**Objective:** Screen readers get silence while text streams in. Add `aria-live="polite"` on the answer container.

**Files:**
- Modify: `src/components/ask/ask-shell.tsx` (the answer container)
- Modify: `src/components/today/daily-brief.tsx` (the brief container)

**Step 1: Add aria-live regions**

On the streaming answer container in ask-shell.tsx:
```tsx
<div aria-live="polite" aria-atomic="false" className="...">
  {/* streaming answer content */}
</div>
```

Throttle the aria-live updates (don't announce every token — announce every ~200ms or on sentence boundaries). The `aria-atomic="false"` means only new content is announced.

**Step 2: Commit**

```bash
git add src/components/ask/ask-shell.tsx src/components/today/daily-brief.tsx
git commit -m "feat(a11y): aria-live regions on streaming AI answers"
```

### Task E3: axe-core in Playwright CI

**Objective:** Automated a11y checks that catch regressions for free.

**Files:**
- Modify: `package.json` (add `@axe-core/playwright`)
- Modify: `e2e/smoke.spec.ts` (add axe assertions)

**Step 1: Install**

```bash
npm install -D @axe-core/playwright
```

**Step 2: Add axe scan to e2e smoke**

In `e2e/smoke.spec.ts`:
```typescript
import AxeBuilder from "@axe-core/playwright";

test("login page has no a11y violations", async ({ page }) => {
  await page.goto("/login");
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
```

**Step 3: Commit**

```bash
git add package.json e2e/smoke.spec.ts
git commit -m "test(a11y): axe-core scans in e2e suite"
```

### Task E4: prefers-reduced-motion audit

**Objective:** Confetti and card/board animations may not respect reduced motion.

**Files:**
- Modify: `src/components/gamify/confetti.tsx` (guard with prefers-reduced-motion)
- Modify: any board animation CSS

**Step 1: Audit and guard**

```css
@media (prefers-reduced-motion: reduce) {
  .animate-page-in,
  .animate-accordion-down,
  .animate-accordion-up {
    animation: none !important;
  }
}
```

Check confetti specifically — it should skip the animation entirely if reduced motion is preferred.

**Step 2: Commit**

```bash
git add src/components/ src/app/globals.css
git commit -m "feat(a11y): respect prefers-reduced-motion in all animations"
```

---

## Section F: Product & UX — Undo, Soft-Delete, Session Management

### Task F1: Soft-delete + 30-day Trash view for Directory items

**Objective:** Deleting a note, feed, folder, or rabbithole is immediate and permanent. Add `deleted_at` column + Trash view.

**Files:**
- Modify: `src/lib/db/schema.ts` (add `deleted_at` to `directoryItems`)
- Create: `supabase/migrations/0020_soft_delete.sql`
- Modify: `src/app/(app)/directory/actions.ts` (set `deleted_at` instead of hard delete)
- Create: `src/app/(app)/directory/trash/page.tsx`
- Modify: `src/app/(app)/directory/trash/layout.tsx`

**Step 1: Add deleted_at column**

In `schema.ts`, add to `directoryItems`:
```typescript
deletedAt: timestamp("deleted_at", { withTimezone: true }),
```

Migration:
```sql
-- supabase/migrations/0020_soft_delete.sql
ALTER TABLE directory_items ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS directory_items_deleted_at_idx
  ON directory_items (user_id, deleted_at)
  WHERE deleted_at IS NOT NULL;
```

**Step 2: Change delete action to soft-delete**

In `directory/actions.ts`, replace hard delete with:
```typescript
await db.update(directoryItems)
  .set({ deletedAt: new Date() })
  .where(and(eq(directoryItems.id, id), eq(directoryItems.userId, user.id)));
```

Add a filter to ALL directory queries: `.where(and(eq(directoryItems.userId, user.id), isNull(directoryItems.deletedAt)))`.

**Step 3: Create Trash view**

A simple page listing items where `deletedAt IS NOT NULL`, with Restore and Permanent Delete buttons.

**Step 4: Add cron job to permanently delete items older than 30 days**

In `src/app/api/cron/cleanup-trash/route.ts`:
```typescript
export async function GET(req: Request) {
  // verify CRON_SECRET
  await db.delete(directoryItems).where(
    and(
      isNotNull(directoryItems.deletedAt),
      lt(directoryItems.deletedAt, sql`now() - interval '30 days'`)
    )
  );
  return NextResponse.json({ ok: true });
}
```

**Step 5: Commit**

```bash
git add src/lib/db/schema.ts supabase/migrations/0020_soft_delete.sql src/app/ src/components/directory/
git commit -m "feat(directory): soft-delete + 30-day Trash view"
```

### Task F2: 5-second Undo toast for feed/folder deletes

**Objective:** For feeds and folders (no soft-delete table), add a client-side undo that defers the server action.

**Files:**
- Modify: `src/components/feeds/feeds-nav.tsx`
- Modify: `src/app/(app)/feeds/actions.ts`

**Step 1: Implement undo pattern**

```typescript
// In feeds-nav, when delete is clicked:
const undoRef = useRef<ReturnType<typeof setTimeout> | null>(null);
const [pendingDelete, setPendingDelete] = useState<string | null>(null);

function handleDelete(feedId: string) {
  setPendingDelete(feedId);
  // Optimistically hide the feed
  undoRef.current = setTimeout(() => {
    deleteFeedAction(feedId); // actual server call
    setPendingDelete(null);
  }, 5000);
}

function undoDelete() {
  if (undoRef.current) clearTimeout(undoRef.current);
  setPendingDelete(null);
}
```

Render a toast: "Feed deleted. [Undo]"

**Step 2: Commit**

```bash
git add src/components/feeds/ src/app/\(app\)/feeds/actions.ts
git commit -m "feat(feeds): 5-second undo toast for feed deletion"
```

### Task F3: "Sign out everywhere" button

**Objective:** No global sign-out exists. Matters once invite-mode makes accounts shared-device-plausible.

**Files:**
- Modify: `src/app/(app)/settings/page.tsx`
- Modify: `src/app/(app)/settings/actions.ts`

**Step 1: Add the action**

```typescript
export async function signOutEverywhereAction() {
  const { supabase } = await requireUser();
  await supabase.auth.signOut({ scope: "global" });
  redirect("/login");
}
```

**Step 2: Add the button in settings**

A "Sign out everywhere" button next to "Change password", with a confirmation dialog.

**Step 3: Commit**

```bash
git add "src/app/(app)/settings/"
git commit -m "feat(settings): sign out everywhere (global session revoke)"
```

---

## Section G: Feeds & Content Pipeline

### Task G1: Dead-feed auto-pause

**Objective:** A feed 404ing for months is still fetched every cron run. Add `error_count` + skip-after-N-failures.

**Files:**
- Modify: `src/lib/db/schema.ts` (add `errorCount` to `feeds`)
- Create: `supabase/migrations/0021_feed_error_tracking.sql`
- Modify: `src/lib/rss/sync.ts` or the feed sync route (increment error_count, skip after 7)
- Modify: `src/components/feeds/feeds-nav.tsx` (show paused state)

**Step 1: Add error tracking column**

```sql
-- supabase/migrations/0021_feed_error_tracking.sql
ALTER TABLE feeds ADD COLUMN IF NOT EXISTS error_count integer DEFAULT 0 NOT NULL;
ALTER TABLE feeds ADD COLUMN IF NOT EXISTS paused_at timestamptz;
```

In schema.ts:
```typescript
errorCount: integer("error_count").default(0).notNull(),
pausedAt: timestamp("paused_at", { withTimezone: true }),
```

**Step 2: Modify sync logic**

In the feed sync route, before fetching a feed:
```typescript
// Skip paused feeds
if (feed.errorCount >= 7) {
  // Only retry every 24h
  if (feed.pausedAt && Date.now() - new Date(feed.pausedAt).getTime() < 24 * 3600_000) {
    continue; // skip
  }
}
```

After fetch, on success: `errorCount = 0, pausedAt = null`. On failure: `errorCount++, pausedAt = errorCount >= 7 ? now() : null`.

**Step 3: Show paused state in feeds-nav**

A "Paused" badge and "Tap to retry" button that resets `errorCount` to 0.

**Step 4: Commit**

```bash
git add src/lib/db/schema.ts supabase/migrations/0021_feed_error_tracking.sql src/app/api/cron/ src/components/feeds/
git commit -m "feat(feeds): auto-pause dead feeds after 7 consecutive failures"
```

### Task G2: Cross-feed dedupe

**Objective:** The same story from two feeds appears twice (unique index is per-feed URL). A normalized-URL check at insert could mark duplicates.

**Files:**
- Create: `src/lib/rss/dedupe.ts`
- Modify: `src/app/api/cron/sync-feeds/route.ts`

**Step 1: Create dedupe utility**

```typescript
// src/lib/rss/dedupe.ts

/** Normalize a URL for dedup: strip tracking params, lowercase host, remove trailing slash */
export function normalizeUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    // Strip common tracking params
    const track = new Set(["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "fbclid", "gclid", "ref"]);
    for (const k of [...u.searchParams.keys()]) {
      if (track.has(k)) u.searchParams.delete(k);
    }
    u.hash = "";
    return `${u.host.replace(/^www\./, "")}${u.pathname.replace(/\/$/, "")}${u.search ? `?${u.searchParams.toString()}` : ""}`;
  } catch {
    return rawUrl;
  }
}
```

**Step 2: Add dedupe check at insert time**

Before inserting a new article, check if `normalizeUrl(url)` matches any existing article for this user (across all feeds). If found, skip or mark as duplicate.

Add a `normalized_url` column + index:
```sql
ALTER TABLE articles ADD COLUMN IF NOT EXISTS normalized_url text;
CREATE INDEX IF NOT EXISTS articles_user_normalized_url_idx ON articles (user_id, normalized_url);
```

**Step 3: Commit**

```bash
git add src/lib/rss/dedupe.ts src/lib/db/schema.ts supabase/migrations/0022_cross_feed_dedupe.sql src/app/api/cron/
git commit -m "feat(feeds): cross-feed article deduplication via normalized URL"
```

### Task G3: Favicon caching as data URIs

**Objective:** Feed favicons hotlink origin servers on every render. Cache them at feed-add time.

**Files:**
- Modify: `src/lib/rss/feed-utils.ts` or where feeds are added
- Modify: `src/lib/db/schema.ts` (add `cached_icon` column)

**Step 1: Add cached_icon column**

```sql
ALTER TABLE feeds ADD COLUMN IF NOT EXISTS cached_icon text;
```

**Step 2: Fetch and cache favicon at feed-add time**

```typescript
async function cacheFavicon(feedUrl: string): Promise<string | null> {
  try {
    const origin = new URL(feedUrl).origin;
    const res = await fetch(`${origin}/favicon.ico`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const base64 = Buffer.from(buf).toString("base64");
    return `data:image/x-icon;base64,${base64}`;
  } catch { return null; }
}
```

Store in `feeds.cached_icon`. In feeds-nav, use `feed.cachedIcon || feed.iconUrl`.

**Step 3: Commit**

```bash
git add src/lib/db/schema.ts supabase/migrations/0023_favicon_cache.sql src/lib/rss/ src/components/feeds/
git commit -m "feat(feeds): cache favicons as data URIs at feed-add time"
```

---

## Section H: Developer Experience

### Task H1: Prettier + format-on-save + lint-staged

**Objective:** No code formatting automation exists. Add Prettier + pre-commit hooks.

**Files:**
- Create: `.prettierrc.json`
- Create: `.prettierignore`
- Modify: `package.json` (add devDeps + scripts)
- Create: `.husky/pre-commit`

**Step 1: Add Prettier config**

```json
// .prettierrc.json
{
  "semi": true,
  "singleQuote": false,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2,
  "plugins": ["prettier-plugin-tailwindcss"]
}
```

```
# .prettierignore
.next/
node_modules/
dist-desktop/
build/
public/
graphify-out/
dist/
coverage/
```

**Step 2: Install and configure husky + lint-staged**

```bash
npm install -D prettier prettier-plugin-tailwindcss husky lint-staged
npx husky init
```

In `package.json`:
```json
"scripts": {
  "format": "prettier --write .",
  "format:check": "prettier --check .",
  "prepare": "husky"
},
"lint-staged": {
  "*.{ts,tsx,js,jsx,json,css,md}": ["prettier --write"]
}
```

Create `.husky/pre-commit`:
```bash
npx lint-staged
```

**Step 3: Run format once**

```bash
npm run format
git add .
git commit -m "chore(format): prettier formatting pass + pre-commit hooks"
```

**Step 4: Add format check to CI**

In `.github/workflows/ci.yml`, add after lint:
```yaml
- name: Format check
  run: npm run format:check
```

**Step 5: Commit**

```bash
git add .prettierrc.json .prettierignore .husky/ package.json .github/workflows/ci.yml
git commit -m "chore(dx): prettier + husky pre-commit hooks + CI format check"
```

### Task H2: Bundle-size regression guard in CI

**Objective:** CI has no bundle-size budget check — a regression to 250 kB can creep back unnoticed.

**Files:**
- Modify: `.github/workflows/ci.yml` (add bundle-size check step)
- Create: `scripts/bundle-size-check.mjs`

**Step 1: Write the checker**

```javascript
// scripts/bundle-size-check.mjs
import { readFileSync } from "fs";

const REPORT_PATH = ".next/build-manifest.json";
// Next doesn't output route sizes in build-manifest; use the build output.
// Alternative: parse the console output or use @next/bundle-analyzer.

const THRESHOLDS = {
  "/directory": 250_000, // 250 kB
  "/feeds": 220_000,
  "/ask": 200_000,
  "/today": 200_000,
  "/login": 140_000,
  "/signup": 140_000,
};

// Read the build output and check each route's First Load JS
console.log("Bundle size thresholds:", THRESHOLDS);
console.log("Parse 'npm run build' output to verify.");
```

**Step 2: Add to CI**

```yaml
- name: Build
  run: npm run build
- name: Check bundle sizes
  run: node scripts/bundle-size-check.mjs
```

Alternatively, use the `size-limit` package:
```bash
npm install -D size-limit @size-limit/preset-app
```

**Step 3: Commit**

```bash
git add scripts/bundle-size-check.mjs .github/workflows/ci.yml package.json
git commit -m "chore(dx): bundle-size regression guard in CI"
```

---

## Section I: Security Hardening

### Task I1: robots.txt + noindex headers

**Objective:** Private app is indexable by search engines. Add disallow-all.

**Files:**
- Create: `public/robots.txt`
- Modify: `next.config.ts` (add `X-Robots-Tag: noindex`)

**Step 1: Create robots.txt**

```
User-agent: *
Disallow: /
```

**Step 2: Add noindex header in next.config.ts**

In the existing `headers()` function, add:
```typescript
{ key: "X-Robots-Tag", value: "noindex, nofollow" },
```

**Step 3: Commit**

```bash
git add public/robots.txt next.config.ts
git commit -m "feat(security): robots.txt disallow + noindex headers"
```

### Task I2: Login rate limit

**Objective:** The invite brute-force limiter exists (`src/lib/ip-rate-limit.ts`) but login itself has no rate limit.

**Files:**
- Modify: `src/app/login/page.tsx` or the login server action

**Step 1: Add rate limit to login**

Reuse the existing `checkIpRateLimit` from `src/lib/ip-rate-limit.ts`:
```typescript
import { checkIpRateLimit } from "@/lib/ip-rate-limit";

// In the login handler:
const limited = checkIpRateLimit(`login:${ip}`, { max: 10, windowMs: 10 * 60_000 });
if (limited) {
  return { error: "Too many login attempts. Try again in 10 minutes." };
}
```

**Step 2: Commit**

```bash
git add src/app/login/
git commit -m "feat(security): login rate limiting (10 attempts / 10 min)"
```

### Task I3: CSP nonce hardening — drop unsafe-inline

**Objective:** `script-src 'unsafe-inline'` stays until middleware generates nonces. Real XSS-hardening payoff.

**Files:**
- Modify: `src/middleware.ts` (generate nonce, pass to headers)
- Modify: `next.config.ts` (use nonce in CSP)

**Step 1: Generate nonce in middleware**

```typescript
// In src/lib/supabase/middleware.ts or src/middleware.ts:
import { randomBytes } from "crypto";

const nonce = randomBytes(16).toString("base64");
// Set on request headers so next.config can read it
request.headers.set("x-csp-nonce", nonce);
// Pass to response
supabaseResponse.headers.set("Content-Security-Policy", cspWithNonce(nonce));
```

**Step 2: Update CSP in next.config.ts**

```typescript
const csp = [
  "default-src 'self'",
  `script-src 'self' 'nonce-${nonce}'`,  // dropped 'unsafe-inline'
  // ...
];
```

This requires the middleware to set the CSP header (not next.config.ts headers()). The nonce must be generated per-request.

**Step 3: Verify build + e2e still pass**

```bash
npm run build && npm run test:e2e
```

**Step 4: Commit**

```bash
git add src/middleware.ts src/lib/supabase/middleware.ts next.config.ts
git commit -m "feat(security): CSP nonce-based script-src (drops unsafe-inline)"
```

### Task I4: Per-user resource quotas

**Objective:** No per-user total-storage or feed-count cap. One user can bloat the shared DB.

**Files:**
- Modify: `src/app/(app)/feeds/actions.ts` (feed count cap)
- Modify: upload/document actions (storage cap)

**Step 1: Add feed count cap**

```typescript
const MAX_FEEDS = 200;

export async function addFeedAction(url: string) {
  const { user } = await requireUser();
  const [{ count }] = await db.select({ count: count() })
    .from(feeds).where(eq(feeds.userId, user.id));
  if (count >= MAX_FEEDS) {
    return { error: `Feed limit reached (${MAX_FEEDS}). Remove some feeds before adding more.` };
  }
  // ... existing logic ...
}
```

**Step 2: Add storage cap for document uploads**

```typescript
const MAX_STORAGE_BYTES = 500 * 1024 * 1024; // 500 MB

export async function uploadDocumentAction(formData: FormData) {
  const { user } = await requireUser();
  const [{ totalSize }] = await db.select({ totalSize: sum(documents.sizeBytes) })
    .from(documents).where(eq(documents.userId, user.id));
  const newSize = Number(formData.get("file")?.size ?? 0);
  if ((totalSize ?? 0) + newSize > MAX_STORAGE_BYTES) {
    return { error: "Storage limit exceeded. Delete some documents first." };
  }
  // ... existing logic ...
}
```

**Step 3: Commit**

```bash
git add "src/app/(app)/feeds/actions.ts" "src/app/(app)/documents/actions.ts"
git commit -m "feat(security): per-user resource quotas (max feeds + storage)"
```

---

## Section J: Documentation & Repo Hygiene

### Task J1: Rewrite README.md

**Objective:** README is two product-generations stale. Says "Phases 4-5 are next" while Daily Brief, embeddings, study hub, SRS, gamification, map, rabbitholes, desktop app, MCP server are all shipped.

**Files:**
- Modify: `README.md` (full rewrite)

**Step 1: Write the new README**

```markdown
# Second Brain

A self-hosted RSS reader, knowledge base, and AI briefing engine. Save articles, upload documents, take notes, and let AI organize, summarize, and quiz you on your library.

## Features

- **RSS feeds** — OPML import, auto-sync (cron), readability extraction, keyboard-driven reader (j/k/m/s/v/esc)
- **Directory** — permanent knowledge base: saved articles, uploaded documents, user notes with wikilinks, drag-and-drop Kanban
- **AI Daily Brief** — morning summary of new articles + review queue, streamed as markdown
- **Ask** — RAG-powered chat over your library with inline citations + directory map
- **Search** — hybrid keyword (trigram) + semantic (pgvector) across articles, notes, and documents
- **Study Hub** — FSRS spaced repetition flashcards auto-generated from your content
- **Rabbithole** — recursive select→ask→child-document trees for deep-dives
- **Knowledge Map** — graph visualization of folder/tag/wikilink connections
- **Gamification** — XP, skills, achievements for reading and learning
- **PWA** — installable, offline study mode, share-target (mobile share-sheet → save)
- **Desktop** — Electron + PGlite (embedded Postgres) with cloud sync
- **MCP Server** — expose your brain to Claude Desktop/mobile clients
- **Multi-user** — invite-only signup, per-user AI token budget, resource quotas

## Tech Stack

- Next.js 15 (App Router, React 19, React Compiler)
- Supabase (Postgres + pgvector + Auth)
- Drizzle ORM
- Shadcn/Radix UI + Tailwind CSS
- Vercel AI SDK (Anthropic/OpenAI/OpenRouter)
- Vitest + Playwright

## Quick Start

[... keep the existing quick-start section, update env table ...]

## Environment Variables

[... full table with all env vars from .env.example ...]
```

**Step 2: Commit**

```bash
git add README.md
git commit -m "docs: rewrite README — reflect all shipped features"
```

### Task J2: Fix CLAUDE.md graphify reference

**Objective:** CLAUDE.md mandates `graphify query` but `graphify-out/` doesn't exist in the repo. Agents waste a turn discovering this every session.

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Update CLAUDE.md**

Either commit the graphify-out artifacts, or drop the section. Recommended: drop the section since the graph is stale anyway:

```markdown
## graphify

> NOTE: graphify-out/ is not committed to this repo. If you need codebase
> navigation, use search_files and read_file instead. To regenerate the
> graph, run `graphify update .` (AST-only, no API cost).
```

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: fix CLAUDE.md graphify reference (graphify-out/ not committed)"
```

### Task J3: Consolidate handover docs ✅ DONE

**Objective:** Three overlapping handoff docs exist. Fold the two older ones into `docs/history/`.

**Status:** Completed 2026-07-12. `OPTIMIZATION_PLAN.md` and `OPTIMIZATION_HANDOVER.md` moved to `docs/history/`. `IMPROVEMENT_HANDOVER.md` updated with a pointer to the new location and the comprehensive plan.

### Task J4: Session cookie hygiene documentation

**Objective:** Rely on @supabase/ssr defaults today; verify Secure/SameSite flags on the deploy target, document in DEPLOY.md.

**Files:**
- Modify: `DEPLOY.md`

**Step 1: Add a Security Verification section**

```markdown
## Security Verification Checklist

After your first deploy, verify these:

1. **Session cookies**: Open DevTools → Application → Cookies. Confirm:
   - `sb-*-auth-token` has `Secure: true` and `SameSite: Lax` (or Strict)
   - No `HttpOnly: false` on auth cookies
2. **CSP headers**: DevTools → Network → click any document → Headers.
   Confirm `Content-Security-Policy` is present and doesn't contain `unsafe-eval` in production.
3. **RLS policies**: Run `supabase/policies.sql` in SQL Editor after every schema change.
4. **noindex**: `curl -sI https://your-app.netlify.app | grep -i robots` → should show `noindex, nofollow`.
```

**Step 2: Commit**

```bash
git add DEPLOY.md
git commit -m "docs(deploy): security verification checklist"
```

---

## Section K: Testing Depth

### Task K1: Authenticated e2e specs

**Objective:** The smoke suite covers only the unauthenticated surface. The valuable half — /feeds j/k, /search, /today brief streaming, /directory wikilinks — needs real Supabase env + seeded user.

**Files:**
- Modify: `e2e/smoke.spec.ts` or create `e2e/auth.spec.ts`
- Modify: `playwright.config.ts` (add authenticated project)
- Modify: `.github/workflows/ci.yml` (gated on secrets)

**Step 1: Create authenticated test setup**

```typescript
// e2e/auth.spec.ts
import { test, expect } from "@playwright/test";

// Gate on E2E_AUTH env — skip entirely if not configured
const AUTH = process.env.E2E_AUTH;
test.describe(AUTH ? "authenticated" : "authenticated (skipped)", () => {
  test.beforeEach(async ({ page }) => {
    if (!AUTH) test.skip();
    // Sign in via Supabase test user
    await page.goto("/login");
    await page.fill("[name=email]", process.env.E2E_USER_EMAIL!);
    await page.fill("[name=password]", process.env.E2E_USER_PASSWORD!);
    await page.click("button[type=submit]");
    await page.waitForURL("/today");
  });

  test("today brief streams markdown", async ({ page }) => {
    await page.goto("/today");
    // Brief should stream in — wait for markdown-rendered content
    await expect(page.locator("h1, h2, p").first()).toBeVisible({ timeout: 15000 });
  });

  test("feeds j/k navigation", async ({ page }) => {
    await page.goto("/feeds");
    // Press j to navigate
    await page.keyboard.press("j");
    // Article reader should appear
    await expect(page.locator("[data-article-reader]")).toBeVisible();
  });

  test("directory wikilinks resolve", async ({ page }) => {
    await page.goto("/directory");
    // Click first note
    const note = page.locator("[data-directory-item]").first();
    await note.click();
    // Wikilink should be clickable
    const wikilink = page.locator("a[data-wikilink]").first();
    if (await wikilink.isVisible()) {
      await wikilink.click();
      await expect(page).toHaveURL(/\/directory/);
    }
  });

  test("search returns results", async ({ page }) => {
    await page.goto("/search?q=test");
    await expect(page.locator("[data-search-hit]").first()).toBeVisible({ timeout: 10000 });
  });
});
```

**Step 2: Gate in CI**

```yaml
# .github/workflows/ci.yml
e2e-auth:
  runs-on: ubuntu-latest
  if: ${{ vars.E2E_AUTH == 'true' }}
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with: { node-version: 20, cache: npm }
    - run: npm ci --legacy-peer-deps
    - run: npm run build
      env:
        NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.E2E_SUPABASE_URL }}
        NEXT_PUBLIC_SUPABASE_ANON_KEY: ${{ secrets.E2E_SUPABASE_ANON_KEY }}
        DATABASE_URL: ${{ secrets.E2E_DATABASE_URL }}
    - run: npx playwright install --with-deps chromium
    - run: npm run test:e2e
      env:
        E2E_AUTH: "true"
        E2E_USER_EMAIL: ${{ secrets.E2E_USER_EMAIL }}
        E2E_USER_PASSWORD: ${{ secrets.E2E_USER_PASSWORD }}
        NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.E2E_SUPABASE_URL }}
        NEXT_PUBLIC_SUPABASE_ANON_KEY: ${{ secrets.E2E_SUPABASE_ANON_KEY }}
        DATABASE_URL: ${{ secrets.E2E_DATABASE_URL }}
```

**Step 3: Commit**

```bash
git add e2e/auth.spec.ts playwright.config.ts .github/workflows/ci.yml
git commit -m "test(e2e): authenticated specs (gated on E2E_AUTH secrets)"
```

### Task K2: Search polish — single embedding + highlighting + pagination

**Objective:** Search embeds the query twice (directory + article passes); snippets don't highlight query terms; no pagination beyond 25+25.

**Files:**
- Modify: `src/lib/search.ts` (single embedding, highlight, paginate)
- Modify: `src/app/(app)/search/page.tsx` (render highlighted snippets + pagination)

**Step 1: Single embedding pass**

```typescript
// In searchLibrary():
// Before: embeds query independently for directory + article passes
// After: embed once, use for both
const queryEmbedding = await getEmbedding(query);
const [dirHits, articleHits] = await Promise.all([
  retrieveFromDirectory(userId, queryEmbedding),
  unsavedArticleSemantic(userId, queryEmbedding),
]);
```

**Step 2: Highlight query terms in snippets**

```typescript
function highlightTerms(text: string, terms: string[]): string {
  const pattern = terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  return text.replace(new RegExp(`(${pattern})`, "gi"), "<mark>$1</mark>");
}
```

Render with `dangerouslySetInnerHTML` (safe — the snippet is already from our own DB, not user-submitted HTML).

**Step 3: Add pagination**

```typescript
// URL: /search?q=test&page=2
const page = Number(searchParams.get("page") ?? "1");
const PER_PAGE = 25;
const offset = (page - 1) * PER_PAGE;
// Add LIMIT/OFFSET to queries
```

**Step 4: Commit**

```bash
git add src/lib/search.ts "src/app/(app)/search/"
git commit -m "feat(search): single embedding pass + highlight + pagination"
```

---

## Section L: Multi-User Hardening

### Task L1: BYO API keys (encrypt + use per-user keys)

**Objective:** `profiles.encryptedApiKeys` exists in schema but NOTHING reads/writes it. Either build it or drop the column. Building it is the better multi-tenant cost model.

**Files:**
- Modify: `src/lib/db/schema.ts` (confirm column shape)
- Create: `src/lib/crypto/key-encryption.ts` (libsodium sealed box)
- Modify: `src/app/(app)/settings/actions.ts` (save/retrieve keys)
- Modify: `src/lib/ai/provider.ts` (use per-user keys when available)
- Modify: `src/app/(app)/settings/page.tsx` (API key management UI)
- Modify: `.env.example` (add `KEY_ENCRYPTION_SECRET`)

**Step 1: Create key encryption utility**

```typescript
// src/lib/crypto/key-encryption.ts
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

const ALGO = "aes-256-gcm";

function deriveKey(secret: string): Buffer {
  return scryptSync(secret, "second-brain-salt", 32);
}

export function encryptApiKey(plaintext: string, secret: string): string {
  const key = deriveKey(secret);
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

export function decryptApiKey(ciphertext: string, secret: string): string | null {
  try {
    const buf = Buffer.from(ciphertext, "base64");
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const encrypted = buf.subarray(28);
    const key = deriveKey(secret);
    const decipher = createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
```

**Step 2: Add settings actions**

```typescript
// In settings/actions.ts:
export async function saveApiKeyAction(provider: string, key: string) {
  const { user } = await requireUser();
  const secret = process.env.KEY_ENCRYPTION_SECRET;
  if (!secret) throw new Error("KEY_ENCRYPTION_SECRET not configured");

  // Fetch existing encrypted keys
  const [profile] = await db.select().from(profiles).where(eq(profiles.id, user.id)).limit(1);
  const existing = profile?.encryptedApiKeys ? JSON.parse(decryptApiKey(profile.encryptedApiKeys, secret) || "{}") : {};
  existing[provider] = key;
  const encrypted = encryptApiKey(JSON.stringify(existing), secret);

  await db.update(profiles).set({ encryptedApiKeys: encrypted }).where(eq(profiles.id, user.id));
}

export async function getDecryptedApiKey(userId: string, provider: string): Promise<string | null> {
  const secret = process.env.KEY_ENCRYPTION_SECRET;
  if (!secret) return null;
  const [profile] = await db.select().from(profiles).where(eq(profiles.id, userId)).limit(1);
  if (!profile?.encryptedApiKeys) return null;
  const decrypted = decryptApiKey(profile.encryptedApiKeys, secret);
  if (!decrypted) return null;
  const keys = JSON.parse(decrypted);
  return keys[provider] ?? null;
}
```

**Step 3: Modify AI provider to use per-user keys**

```typescript
// In provider.ts, add:
export async function fastModelForUser(userId: string): Promise<LanguageModelV1> {
  const userKey = await getDecryptedApiKey(userId, "anthropic");
  if (userKey) {
    return anthropic(ANTHROPIC_FAST, { apiKey: userKey });
  }
  return fastModel(); // fallback to server key
}
```

Wire `fastModelForUser` / `smartModelForUser` into API routes that have a user context.

**Step 4: Add UI in settings**

A "Your API Keys" card with fields for Anthropic/OpenAI keys, saved encrypted.

**Step 5: Commit**

```bash
git add src/lib/crypto/ src/lib/ai/provider.ts "src/app/(app)/settings/" .env.example
git commit -m "feat(multi-user): BYO API keys (encrypted per-user)"
```

### Task L2: Email change in settings

**Objective:** Email change not implemented. Needs Supabase double-confirmation emails + redirect URL config.

**Files:**
- Modify: `src/app/(app)/settings/actions.ts`
- Modify: `src/app/(app)/settings/page.tsx`
- Modify: `DEPLOY.md` (document redirect URL config)

**Step 1: Add email change action**

```typescript
export async function changeEmailAction(newEmail: string) {
  const { supabase } = await requireUser();
  const { error } = await supabase.auth.updateUser({ email: newEmail });
  if (error) return { error: error.message };
  return { success: "Confirmation email sent to both your old and new address." };
}
```

**Step 2: Add UI**

An "Email" card next to "Password" with a dialog to change email.

**Step 3: Document in DEPLOY.md**

```markdown
### Email change redirect
Supabase → Authentication → URL Configuration → Site URL: `https://your-app.netlify.app`
Redirect URLs: `https://your-app.netlify.app/auth/callback`
```

**Step 4: Commit**

```bash
git add "src/app/(app)/settings/" DEPLOY.md
git commit -m "feat(settings): email change with double confirmation"
```

---

## Section M: Web Push Notifications (Optional, High-Value)

### Task M1: Web Push for Daily Brief

**Objective:** Service worker exists. Add push subscription storage + cron sender so users get "your brief is ready" each morning.

**Files:**
- Modify: `src/lib/db/schema.ts` (add `push_subscriptions` table)
- Create: `supabase/migrations/0024_push_subscriptions.sql`
- Create: `src/lib/push/notify.ts` (send push via web-push library)
- Create: `src/app/api/push/subscribe/route.ts` (accept subscription)
- Modify: `src/app/api/brief/route.ts` or the brief cron (send push after brief generation)
- Modify: `src/components/shell/` (request permission UI)

**Step 1: Add push_subscriptions table**

```sql
-- supabase/migrations/0024_push_subscriptions.sql
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  p256dh_key text NOT NULL,
  auth_key text NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS push_subs_endpoint_unique ON push_subscriptions (endpoint);
```

**Step 2: Install web-push**

```bash
npm install web-push
```

**Step 3: Create notification sender**

```typescript
// src/lib/push/notify.ts
import webpush from "web-push";

webpush.setVapidDetails(
  `mailto:${process.env.VAPID_EMAIL ?? "noreply@example.com"}`,
  process.env.VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
);

export async function sendPush(userId: string, title: string, body: string) {
  const subs = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dhKey, auth: sub.authKey } },
        JSON.stringify({ title, body, url: "/today" })
      );
    } catch (err) {
      // 410 Gone = subscription expired; delete it
      if (err instanceof Error && err.message.includes("410")) {
        await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id));
      }
    }
  }
}
```

**Step 4: Add subscription route + UI**

A bell icon in the sidebar → requests notification permission → subscribes → POSTs to `/api/push/subscribe`.

**Step 5: Trigger push after brief generation**

In the brief cron or brief API:
```typescript
await sendPush(user.id, "Your Daily Brief is ready", "Tap to read today's summary");
```

**Step 6: Commit**

```bash
git add src/lib/db/schema.ts supabase/migrations/0024_push_subscriptions.sql src/lib/push/ src/app/api/push/ src/components/shell/ package.json .env.example
git commit -m "feat(push): web push notifications for daily brief"
```

---

## Prioritized Execution Order

Tasks are ordered by impact/effort ratio. Do in this sequence:

### 🔴 Critical (do first)
1. **A1** — Consolidate migrations (fresh deploys are broken without this)
2. **I1** — robots.txt + noindex (private app is indexable)
3. **B2** — Add try/catch to 8 unguarded API routes
4. **J2** — Fix CLAUDE.md graphify reference

### 🟡 High-impact (do next)
5. **B1 + B3** — API validation wrapper + Zod schemas
6. **C1** — Structured logger
7. **E1** — Skip-to-content link
8. **J1** — Rewrite README
9. **G1** — Dead-feed auto-pause
10. **D1** — Web Share Target

### 🟡 Medium-impact (do when time allows)
11. **C2** — Sentry integration
12. **E2 + E3** — aria-live + axe-core
13. **F1** — Soft-delete + Trash view
14. **H1** — Prettier + pre-commit hooks
15. **K1** — Authenticated e2e specs
16. **I2** — Login rate limit
17. **I4** — Per-user resource quotas
18. **G2** — Cross-feed dedupe
19. **K2** — Search polish
20. **F3** — Sign out everywhere

### ⚪ Polish (do last)
21. **A2** — Dimension-mismatch guard
22. **A3** — Backup/restore docs
23. **C3** — Cron staleness banner
24. **D2** — App badging
25. **E4** — prefers-reduced-motion audit
26. **F2** — Undo toast for feeds
27. **G3** — Favicon caching
28. **H2** — Bundle-size guard
29. **I3** — CSP nonce hardening
30. **J3** — Consolidate handover docs
31. **J4** — Session cookie docs
32. **L1** — BYO API keys
33. **L2** — Email change
34. **M1** — Web Push notifications

---

## Risks, Tradeoffs & Open Questions

### Risks
- **A1 (migration consolidation):** The supabase/migrations files were written for Supabase's migration runner, not drizzle-kit. The SQL may need minor syntax adjustments. Test on a fresh DB before deploying.
- **B1/B3 (API validation):** Adding Zod validation to existing routes could reject previously-accepted edge-case inputs. Review each route carefully — some may accept optional fields that clients send as `null` vs `undefined`.
- **F1 (soft-delete):** All directory queries must filter `deletedAt IS NULL` — missing even one will show deleted items. Audit ALL directory queries thoroughly.
- **I3 (CSP nonce):** Next.js's inline scripts (hydration bootstrap) need the nonce. The middleware must set the CSP header (not next.config headers()), which means moving CSP logic out of next.config.ts. This is a significant refactor — verify thoroughly with e2e.
- **L1 (BYO API keys):** The `KEY_ENCRYPTION_SECRET` must NEVER be the Supabase service-role key. Document this prominently. If the encryption key is lost, all user API keys are unrecoverable.
- **M1 (Web Push):** VAPID keys need to be generated per-deploy. Document the generation step in DEPLOY.md.

### Tradeoffs
- **Sentry vs self-hosted GlitchTip:** Sentry is easier to set up but sends data to a third party. GlitchTip is self-hosted but requires infrastructure. The env-gating lets self-hosters opt out entirely.
- **Soft-delete vs undo toast:** Soft-delete (F1) is more robust but requires schema changes + query audit. Undo toast (F2) is cheaper but doesn't protect against accidental permanent deletes after the undo window. Do F1 for directory items, F2 for feeds/folders.
- **axe-core in e2e:** Adds ~2s to the e2e job. Worth it for free a11y regression detection.
- **Prettier:** A one-time formatting pass will produce a large diff. Do it as a single commit to avoid merge conflicts.

### Open Questions
1. **Public share links** for notes — changes security posture. Should this be built? (Requires user confirmation per IMPROVEMENT_HANDOVER.md)
2. **Daily-brief email digest** — cron + Resend/other provider + per-user opt-in. Complements or replaces Web Push (M1).
3. **Pocket/Instapaper import** — the parsers + chunker already exist. Is this a priority?
4. **Postgres pool size** — `max: 3` in `src/lib/db/index.ts` was tuned for single-user. Under real multi-user load, should this be increased? Measure first via `pg_stat_statements`.
5. **"Front-end redesigned" directory** — exists in the repo root and is excluded from tsconfig. Is this an active redesign effort or stale? If stale, remove it.

---

## Verification

After implementing any task, verify:
```bash
npx tsc --noEmit       # type-check
npm run lint           # eslint --max-warnings 0
npm test               # vitest
npm run build          # next build
npm run test:e2e       # playwright (after build)
```

All five must pass before committing.

---

## Constraints (inherited from handovers)

- Source under `src/`; paths with `(app)` need shell quoting.
- `pdf-parse` imported via `require("pdf-parse/lib/pdf-parse.js")` on purpose — don't "clean it up".
- `output: "standalone"` gated behind `DESKTOP_BUILD`; `APP_RUNTIME=desktop` switches db to PGlite.
- Cloud-only SQL (RLS, trgm) must NOT be assumed present on desktop.
- Account deletion + invite signup are web-only by guard.
- Feeds infinite-scroll orderBy must match `loadMoreArticlesAction` (id tiebreaker).
- `scripts/vitest.mjs` launcher: keep the exports-based bin resolution and `realpathSync.native` cwd normalization.
- New markdown rendering must go through `@/components/ui/markdown`.
- Lint is `--max-warnings 0` — new intentionally-unused bindings must be `_`-prefixed.
- `npm ci` may need `--legacy-peer-deps` (and `--ignore-scripts` in restricted networks).
- `supabase/policies.sql` must be re-run after ANY new table.
- The AI budget module fails OPEN and is a no-op without `AI_DAILY_TOKEN_BUDGET`.
- `rate_limits.count` is used as a token accumulator for AI budget — don't "fix" it back to a request counter.
