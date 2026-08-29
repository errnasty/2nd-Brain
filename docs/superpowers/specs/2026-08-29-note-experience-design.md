# Note taking & note viewing experience — design

Date: 2026-08-29
Status: approved

## Problem

Notes (`directory_items.kind = 'user_note'`) are written in a raw `<textarea>` and
rendered with `.prose-reader` — a long-form *article* type scale (Georgia serif,
19px, line-height 1.85, `li { my-2 }`). Notes are dense structured text: bullets,
headings, code, tasks. The article scale makes them read mushy, and the plain
textarea gives no formatting affordances at all.

Two independent tracks.

## Constraint

`directory_items.content` is markdown **text**, consumed by embeddings/Ask,
wikilink parsing, AI edit-assist, and export. The editor must keep markdown as
the literal source of truth. This rules out any editor with a lossy
document-model round-trip (TipTap/ProseMirror JSON).

## Track A — CodeMirror 6 editor

Controlled leaf component with the exact contract the textarea had, so autosave,
auto-tag, AI assist, embeddings, and export are untouched:

```
value: string                      // markdown, byte-identical to stored
onChange(next: string)
onSelectionChange({start, end})    // feeds runAssist unchanged
```

Extensions:

- `@codemirror/lang-markdown` with a `HighlightStyle` bound to the app's CSS
  vars, so dark mode needs no separate theme.
- **Live preview**: `ViewPlugin` + `Decoration` hides `**`, `_`, `#`, `` ` ``
  markers on lines the cursor is not on; headings render at real size.
- Keymap: Cmd/Ctrl+B bold, +I italic, +K wrap selection as link, +Shift+K inline
  code, Tab / Shift+Tab list indent.
- `insertNewlineContinueMarkup` — Enter continues `- `, `1. `, `- [ ] `, `> `.
- `@codemirror/autocomplete` on `[[` -> note titles, from a debounced
  `searchNoteTitlesAction(q)` server action.
- `EditorView.lineWrapping`; no gutter, no line numbers — reads as a document.

Lazy-loaded via a `note-editor.tsx` / `note-editor-impl.tsx` split mirroring the
existing `ui/markdown.tsx` pattern, so CodeMirror stays out of the first-load
bundle.

## Track B1 — `.prose-note` type scale

New CSS block in `globals.css`, sibling to `.prose-reader`, applied only when
`kind === 'user_note'`. Declared after `@tailwind utilities` so it wins on source
order (same reason documented for `.prose-answer`).

| | `.prose-reader` | `.prose-note` |
|---|---|---|
| family | Georgia serif | `--app-font-body` sans |
| size / leading | 19px / 1.85 | 16px / 1.6 |
| measure | 68ch | 72ch |
| `p` | `my-5` | `my-3` |
| `li` | `my-2` | `my-1`, tighter `pl-5` |
| headings | 1.85 / 1.5 / 1.25rem | 1.5 / 1.25 / 1.05rem, smaller `mt` |
| blockquote | italic serif pull-quote | left-rule callout, not italic |
| code / pre | inherits 19px | fixed 13.5px, `pre` bordered |
| tables | full borders | header rule + row hairlines |
| checkbox | unstyled | sized and baseline-aligned |

Sizes clamp down one step under 640px — covers the phone half of "reads badly"
without a separate mobile track.

## Track B2 — viewer chrome

- **Outline** — headings parsed from the markdown *source* (so it works in edit
  mode too). Right rail at `xl+`, popover below that, hidden on mobile.
  `IntersectionObserver` on rendered headings for scroll-spy.
- **Sticky title bar** — appears when the `h1` scrolls out of the ScrollArea.
- **Word count + reading time** — outline rail footer, live while editing.
- **Clickable checkboxes in preview** — `mdComponents.input` reads
  `node.position.start.line` and calls `toggleTaskAtLine(content, line)`. Line
  numbers survive `linkifyWikilinks` because that replacement is same-line.
- **Broken wikilink -> create** — `#missing-wikilink` becomes a button that
  creates the note via the existing `createNoteAction({ title })` and navigates.

## File boundaries

`item-viewer.tsx` is ~1000 lines and already holds note editing, article
rendering, doc rendering, four AI actions, and backlinks. New code lands in:

- `src/components/directory/note-editor.tsx` + `note-editor-impl.tsx`
- `src/components/directory/note-outline.tsx`
- `src/lib/notes/markdown.ts` — `extractHeadings`, `toggleTaskAtLine`,
  `slugify`, `wordStats`

`ItemViewer` keeps ownership of `content`, `dirty`, `flushSave`, `selRange`,
`runAssist`. No state moves.

## Backend

None. No migration, no schema change, no new table. One thin
`searchNoteTitlesAction` for `[[` autocomplete.

## Testing

Vitest on the pure functions only:

- `extractHeadings` — nesting, duplicate titles -> unique slugs, headings inside
  fenced code blocks ignored.
- `toggleTaskAtLine` — checked <-> unchecked, nested items, non-task line no-op.
- `wordStats` — strips markdown syntax before counting.

CodeMirror behaviour is verified manually; a jsdom harness is not worth it.

## Out of scope

Full mobile pass, live split view, version history, article-highlight -> note.
