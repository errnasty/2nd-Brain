# Rabbithole Canvas — Handoff for a Coding Agent

You are picking up a partially-executed implementation plan. Most of the work is done and committed; **two tasks remain (6 and 7) plus a final review**. This document is self-contained — you should not need to ask the user anything to finish.

## Where things are

- **Repo:** `c:\Users\Admin\OneDrive\Documents\GitHub\2nd Brain`
- **Branch:** `claude/rabbithole-canvas` (branched off `main`). Do all work here.
- **Full plan (authoritative source of truth, every step has complete code):** `docs/superpowers/plans/2026-07-10-rabbithole-canvas.md`
- **Design spec:** `docs/superpowers/specs/2026-07-10-rabbithole-canvas-design.md`
- **Test runner:** Vitest (`npx vitest run <file>`). Typecheck: `npx tsc --noEmit`. Build: `npm run build`. Dev server: `npm run dev`.
- **Node:** v24.x is installed and builds fine.

## What the feature is

An infinite pan/zoom canvas view for the Rabbithole tab, modeled on the `errnasty/rabbithole` GitHub project. The root document and every answer "branch" render as draggable, markdown-rendered DOM cards on a CSS-transformed world surface. Selecting text in any card opens a "dig" popover (ask a question or tap a lens); the answer streams into a new child card with an SVG edge drawn from the selected phrase. A `[Canvas | Split]` toggle in the tab switches between this new canvas and the pre-existing split view. No new npm dependencies. API routes and DB migration 0019 are untouched.

## Completed & committed (do NOT redo)

| Task | Files | Commit | Verified |
|---|---|---|---|
| 1 | `src/lib/rabbithole/layout.ts` (+ `.test.ts`) — pure tidy-tree layout, `layoutTree(nodes, sizes, collapsed)`, `ROOT_ID`, types `Pos`/`Size`/`LayoutNode`. Root pinned to origin. | `3532936` | 5/5 vitest |
| 3 | `src/components/rabbithole/canvas/dig-popover.tsx` — `DigPopover`, type `DigTarget = { text; parentId; x; y }`. | `100a038` | tsc clean |
| 2 | `src/lib/rabbithole/use-rabbithole.ts` — `useRabbithole(itemId)` → `{ nodes, draft, streaming, byId, childrenOf, pathTo, dig, deleteBranch, setNodes }`, types `RhNode`/`RhDraft`. And rewrote `src/components/reader/rabbithole.tsx` to consume it (behavior unchanged; re-exports `RhNode`). | `daf66ce` | tsc + build clean |
| 4 | `src/components/rabbithole/canvas/use-camera.ts` — `useCamera(viewportRef, worldRef, edgesRef, onChange)` → `{ getCamera, setCamera, screenToWorld, zoomAt, frameRect, apply }`, type `Camera`. Imperative pan/zoom. | `11a8b70` | tsc clean |
| 5 | `src/components/rabbithole/canvas/branch-card.tsx` (`BranchCard`, `CARD_W`), `edges.tsx` (`Edges`, `Edge`), `rabbithole-canvas.tsx` (`RabbitholeCanvas`). Full canvas: layout + drag overrides, pan/zoom, text-select → dig → streaming child card, collapse, toolbar (zoom/frame-all/tidy), localStorage persistence `rh.canvas.pos.<itemId>` and `rh.canvas.view.<itemId>`. | `b5a3cc3` | tsc + build clean; passed a spec + correctness review |

`RabbitholeCanvas` compiles standalone but is **not yet wired into the UI** — that is Task 6.

### Notes carried forward from review

- Task 5 got a correctness review. Two minor bugs were already fixed in commit `b5a3cc3` (scroll-listener re-bind after collapse/expand; stale zoom-% readout).
- The reviewer flagged one **latent** issue: `RabbitholeCanvas` local state (`sizes`, `collapsed`, `dragOverrides` — the last lazy-loaded from localStorage once) does not reset when the `itemId` prop changes without a remount. Switching holes (`/rabbithole?item=<a>` → `?item=<b>`) changes `itemId` on the same component instance, so this state would leak across documents. **Fix in Task 6 by giving the canvas a `key={root.itemId}`** so a hole switch remounts it and re-reads persistence. This is already included in the Task 6 edits below — don't skip it.

## Task 6 — Wire the Canvas/Split toggle into the tab shell (DO THIS)

**File to modify:** `src/components/rabbithole/rabbithole-shell.tsx` (only this file).

**Goal:** Add a `[Canvas | Split]` toggle to the tab header. Canvas is the default on `lg+` screens, split on smaller; the choice persists in `localStorage["rh.tab.mode"]`. Canvas renders `<RabbitholeCanvas>`; split renders the existing layout. "Open in split" from a card switches the toggle to split.

### Step 6.1 — Imports

At the top of the file, add these imports (the file currently imports `useRef` from react and various lucide icons — merge, don't duplicate):

```tsx
import { useEffect, useRef, useState } from "react";
import { LayoutGrid, Rows } from "lucide-react";
import { RabbitholeCanvas } from "@/components/rabbithole/canvas/rabbithole-canvas";
```

Keep the existing imports (`useRouter`, `ReactMarkdown`, `remarkGfm`, `ExternalLink`, `Library`, `Rabbit`, `ScrollArea`, `cn`, `formatRelativeTime`, `Rabbithole`).

### Step 6.2 — View-mode state

Find:
```tsx
  const router = useRouter();
  const bodyRef = useRef<HTMLDivElement>(null);
```
Replace with:
```tsx
  const router = useRouter();
  const bodyRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<"canvas" | "split">("split");

  // Resolve the default once on the client: canvas on desktop, split on mobile,
  // unless the user has a saved preference.
  useEffect(() => {
    const saved = window.localStorage.getItem("rh.tab.mode");
    if (saved === "canvas" || saved === "split") {
      setMode(saved);
      return;
    }
    setMode(window.matchMedia("(min-width: 1024px)").matches ? "canvas" : "split");
  }, []);

  const chooseMode = (m: "canvas" | "split") => {
    setMode(m);
    try { window.localStorage.setItem("rh.tab.mode", m); } catch {}
  };
```

### Step 6.3 — Replace the `root ? (...)` document/branch layout

The current code (inside `return (...)`) has a block that begins:

```tsx
      {root ? (
        <div className="flex min-w-0 flex-1 flex-col lg:flex-row">
          {/* Root document */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
              <span className="truncate text-sm font-semibold">{root.title}</span>
              ...
```

…and continues through the "Root document" `ScrollArea` and the "Branch panel" `<Rabbithole variant="inline" .../>`, ending just before the `) : (` that starts the "No hole selected" hero.

Replace that ENTIRE `root ? ( ... )` first arm (everything from `{root ? (` up to but **not including** the `) : (`) with the following. The `) : (` hero arm and everything after it stays exactly as-is.

```tsx
      {root ? (
        <div className="flex min-w-0 flex-1 flex-col">
          {/* View toggle */}
          <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
            <span className="truncate text-sm font-semibold">{root.title}</span>
            <div className="ml-auto flex items-center gap-0.5 rounded-md border border-border p-0.5">
              <button
                onClick={() => chooseMode("canvas")}
                className={cn(
                  "inline-flex items-center gap-1 rounded px-2 py-1 text-xs",
                  mode === "canvas" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
                title="Canvas view"
              >
                <LayoutGrid className="h-3.5 w-3.5" /> Canvas
              </button>
              <button
                onClick={() => chooseMode("split")}
                className={cn(
                  "inline-flex items-center gap-1 rounded px-2 py-1 text-xs",
                  mode === "split" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
                title="Split view"
              >
                <Rows className="h-3.5 w-3.5" /> Split
              </button>
            </div>
            <button
              onClick={() => router.push(`/directory?item=${root.itemId}`)}
              className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              title="Open in Directory"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Directory
            </button>
          </div>

          {mode === "canvas" ? (
            <RabbitholeCanvas
              key={root.itemId}
              itemId={root.itemId}
              rootTitle={root.title}
              rootText={root.text}
              onOpenInSplit={() => chooseMode("split")}
            />
          ) : (
            <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
              {/* Root document */}
              <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                <ScrollArea className="flex-1">
                  <div ref={bodyRef} className="mx-auto max-w-[68ch] px-6 py-8">
                    {root.text.trim() ? (
                      root.markdown ? (
                        <div className="prose-reader">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{root.text}</ReactMarkdown>
                        </div>
                      ) : (
                        <div className="whitespace-pre-wrap font-[Georgia,'Times_New_Roman',serif] text-[1.05rem] leading-[1.85]">
                          {root.text}
                        </div>
                      )
                    ) : (
                      <p className="italic text-muted-foreground">No readable text in this item yet.</p>
                    )}
                  </div>
                </ScrollArea>
              </div>

              {/* Branch panel */}
              <div className="h-[45vh] shrink-0 border-t border-border lg:h-auto lg:w-[440px] lg:border-l lg:border-t-0">
                <Rabbithole
                  variant="inline"
                  itemId={root.itemId}
                  rootTitle={root.title}
                  bodyRef={bodyRef}
                  enabled
                  open
                  onOpenChange={() => {}}
                />
              </div>
            </div>
          )}
        </div>
      ) : (
```

Notes:
- The old document header (the `<span>{root.title}</span> — select text to dig` + Directory button) is replaced by the new toggle row. The "— select text to dig" hint is dropped; that's intended.
- `key={root.itemId}` on `RabbitholeCanvas` is the state-leak fix — keep it.
- `bodyRef` is still used by the split-view `<Rabbithole>`.

### Step 6.4 — Verify & commit
```bash
npx tsc --noEmit && npm run build
```
Both must be clean. Then:
```bash
git add src/components/rabbithole/rabbithole-shell.tsx
git commit -m "feat(rabbithole): Canvas/Split view toggle in the tab"
```

## Task 7 — End-to-end manual verification (DO THIS)

Run `npm run dev`, open `/rabbithole`, pick a Directory item that already has a hole (or dig a fresh one). Verify each; fix anything broken and commit fixes.

**Canvas:**
- Canvas is the default on a desktop-width window; the root document renders as a card.
- Wheel scrolls the canvas (pan); a wheel gesture started inside a card scrolls that card instead.
- Ctrl/⌘+wheel zooms toward the cursor; toolbar +/−, reset (%), and Frame-all work; the zoom % updates.
- Select text in the root card → popover; tap a lens → a child card streams in; an edge draws from near the selected text.
- Select text in a branch card → dig again; a deeper card + edge appear.
- Drag a card header repositions it; Tidy resets positions and frames all.
- Collapse hides a subtree and its edges; expand restores them (and scrolling a re-expanded card keeps its edge anchored).
- "Open in split" (the PanelRight icon on a card header) switches to split view; toggling back to canvas restores the camera.
- Delete a branch (Trash icon) removes it and its subtree.
- Reload the page → camera and card positions persist for that item; switching to a different hole shows that hole's own layout (no leakage).

**Split-view regression:** toggle to Split — confirm the original experience (root doc left, branch panel right, breadcrumbs, dig, delete) is unchanged.

**Final gates:**
```bash
npm run test && npm run build
```
All tests pass; production build succeeds. Commit any fixes:
```bash
git add -A && git commit -m "fix(rabbithole): canvas verification follow-ups"
```

## Final steps (DO THIS)

1. **Full-diff review** of the whole feature: `git diff main...claude/rabbithole-canvas`. Look for correctness bugs, leftover debug code, and anything that diverges from the spec. Fix and commit.
2. **Finish the branch:** open a PR to `main` (or merge, per the user's preference — ask if unsure). Suggested PR title: `feat(rabbithole): infinite canvas view`.
3. **Refresh the knowledge graph** (required by the repo's `CLAUDE.md`): `graphify update .`

## Guardrails

- No new npm dependencies. Everything uses `react-markdown`, `remark-gfm`, `lucide-react`, `sonner`, Tailwind — all already present.
- Don't touch `/api/rabbithole` routes, `supabase/migrations/0019_rabbithole.sql`, or the reader-drawer variant beyond what Task 2 already did.
- The commits for Tasks 1–5 are unpushed on `claude/rabbithole-canvas`; leave their history alone (don't rebase/squash unless the user asks).
- Deliberate spec deviations already agreed: stream errors surface as a toast and drop the draft (no dedicated Retry/Discard error card); `findTextRect` anchor resolution is verified manually, not unit-tested (jsdom stubs `getBoundingClientRect` to zeros). See the plan's "Deliberate deviations from the spec" section.

## Quick reference — the canvas component's public API (for Task 6)

```tsx
<RabbitholeCanvas
  itemId={string}                 // Directory item id; also the localStorage key namespace
  rootTitle={string}              // root document title (root card header)
  rootText={string}               // root document body (markdown-rendered in the root card)
  onOpenInSplit={(nodeId: string | null) => void}  // called when a card's "open in split" is clicked
/>
```
Give it `key={itemId}` so switching holes remounts it.
