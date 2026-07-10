# Rabbithole Canvas — Design

**Date:** 2026-07-10
**Status:** Approved (brainstorm complete)
**Reference:** https://github.com/errnasty/rabbithole — `src/core/html/client/canvas-view.js` (DOM-transform canvas, tidy-tree layout, text-anchored SVG edges)

## Summary

Add an infinite pan/zoom canvas view to the Rabbithole tab. Every node in a
hole — the root document and each answer branch — renders as a real DOM card
with markdown content. Selecting text in any card opens the existing ask/lens
popover; the answer streams into a new child card on the canvas with an edge
drawn from the exact selected phrase. The canvas is a view mode alongside the
existing split view, behind a `[Canvas | Split]` toggle in the tab header.

Decisions made during brainstorming:

1. **Experience:** full infinite canvas with document cards (like the
   reference repo), not a minimap-style local graph.
2. **View mode:** toggle in the Rabbithole tab header. Canvas is the default
   on desktop (`lg+`); split view is the default on smaller screens. Choice
   persists in localStorage. The split view and the reader drawer variant are
   unchanged.
3. **Interactivity:** full dig-on-canvas. Cards are selectable DOM; asking
   from a selection spawns a streaming child card directly on the canvas.
4. **Engine:** hand-rolled, porting the reference repo's mechanics. No new
   dependencies (no React Flow, no d3). Matches the existing custom
   `knowledge-map.tsx` ethos.

## Architecture

New module: `src/components/rabbithole/canvas/`

| File | Responsibility |
|------|----------------|
| `rabbithole-canvas.tsx` | Top-level canvas view: viewport div (overflow hidden) containing the SVG edge layer and the CSS-transformed "world" div holding all cards. Renders the toolbar. |
| `branch-card.tsx` | One node card: header (title, drag handle, collapse toggle, open-in-split button), scrollable ReactMarkdown body, streaming/error states. Root card renders the root document. |
| `use-canvas-view.ts` | Pan/zoom camera state held in refs; applies `translate(x,y) scale(s)` to the world div imperatively (no React re-render per frame). Gesture semantics ported from the reference. |
| `layout.ts` | Pure tidy-tree layout function: `(nodes, sizes, overrides) → positions`. Children form a column to the right of their parent, stacked with a fixed gap; subtree bounds computed via union. Unit-testable. |
| `edges.tsx` | Computes SVG bezier paths per parent→child edge. Edge start = position of the highlighted anchor-text span inside the parent card (falls back to the parent card's right edge midpoint when the span isn't found/visible). Includes the anchor dot. |

### View hierarchy

```
<div viewport (overflow-hidden, relative)>
  <svg edges (absolute, full-size, transformed with world) />
  <div world style="transform: translate(x,y) scale(s)">
    <BranchCard/> × N   ← absolutely positioned, real DOM, selectable text
  </div>
  <Toolbar/>            ← fixed overlay: zoom −/％/＋, frame-all, tidy, view toggle
</div>
```

### Shared state: `use-rabbithole.ts`

Extract the node/streaming/mutation logic currently inside
`src/components/reader/rabbithole.tsx` into a hook at
`src/lib/rabbithole/use-rabbithole.ts` (next to the existing `lenses.ts`):

- node list fetch (`/api/rabbithole?itemId=`), keyed by itemId
- ask flow: draft creation, sentinel streaming (`RABBITHOLE_SENTINEL`),
  persistence, abort
- delete-subtree (`collectSubtreeIds`)
- derived helpers: `byId`, `childrenOf`

Both the split view's branch panel and the canvas consume this one hook
instance inside the Rabbithole tab, so toggling views never double-fetches
and never diverges. The reader drawer (`variant="drawer"`) consumes the same
hook. `rabbithole.tsx` keeps its selection popover + breadcrumb UI; only the
data/stream engine moves out.

## Interaction spec (ported reference semantics)

- **Wheel** on background = pan. **Ctrl+wheel** = zoom toward cursor
  (clamped MIN/MAX scale). A trackpad gesture keeps the target it started
  on: a scroll begun inside a card scrolls that card even if the cursor
  drifts; a pan begun on the background stays a pan. A pause (>~180ms) ends
  the gesture.
- **Drag** background = pan. **Drag** card header = move card (pointer
  capture; `pointercancel`/`lostpointercapture` always clean up).
- **Select text** in any card → existing popover (ask question or tap lens)
  → child card appears immediately in streaming state; camera glides to
  reveal it; edge draws from the anchor span.
- **Hover** a child card → its edge and the anchor text in the parent
  highlight.
- **Collapse** on a card hides its subtree (edges included); hidden
  descendants keep their positions. Collapsed indicator shows descendant
  count.
- **Open-in-split** button (and card header double-click) switches to split
  view navigated to that branch.
- **Toolbar:** zoom in/out (15% steps toward viewport center), zoom label
  (click = reset to 100%), frame-all (fit whole tree, animated glide), tidy
  (re-run layout, clearing drag overrides for visible nodes).
- **Reduced motion / hidden tab:** glides jump instantly.

## Layout & positions

- Tidy-tree layout is the deterministic default: root at origin, each
  child column placed right of its parent, siblings stacked top-to-bottom
  with a fixed gap, subtree bounds unioned so cousins never overlap.
- Card sizes come from a ResizeObserver per card (cards have a default
  width; height fits content up to a max, then the body scrolls).
- Manual drags store per-node offsets in localStorage keyed by itemId
  (`rh.canvas.pos.<itemId>`). No DB migration. Tidy button clears overrides.
- Camera (pan/zoom) per item also persists to localStorage
  (`rh.canvas.view.<itemId>`), restored on reopen; falls back to frame-all.

## Streaming & errors

- Ask → optimistic child card in "streaming" state; content chunks append
  live (same sentinel protocol as today). On completion the node is
  persisted via the existing API and swaps to normal state.
- Stream failure or abort → card shows an error state with Retry and
  Discard actions. Discard removes the draft card. Retry re-issues the ask
  with the same anchor/question/lens.
- API routes and DB schema are unchanged. Migration 0019 already covers the
  data model.

## Performance

- Canvas DOM (cards) builds when the canvas view is first shown for an item,
  not on tab load when split view is active.
- Camera transform is imperative via refs — zero React renders during
  pan/zoom.
- Edge redraws are batched through a single rAF scheduler; card scroll,
  drag, and streaming all call `scheduleEdges()`.
- Markdown renders once per node content change (memoized cards).

## Mobile

- Below `lg`, the tab defaults to split view (current experience). Canvas
  remains reachable via the toggle; pinch-zoom and touch-drag work through
  the same pointer-event handlers, but mobile polish is not a goal of this
  iteration.

## Testing

- `layout.ts`: unit tests — single chain, wide fan-out, collapsed subtree
  retention, no-overlap invariant.
- Edge anchor resolution: unit test the anchor-span lookup fallback chain.
- Interaction (pan/zoom/drag/select/stream): manual verification via the
  running app (`/verify` flow) — documented steps in the implementation plan.

## Out of scope

- DB-persisted card positions / cross-device canvas layout sync.
- Card resize handles and per-card font scaling (reference has them; YAGNI
  for v1).
- Canvas for the reader drawer variant.
- Mobile gesture polish beyond "works".
