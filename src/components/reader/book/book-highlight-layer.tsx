"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Highlighter, MessageSquarePlus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  rangeForOffsets,
  rectsForRange,
  selectionOffsets,
  type ChapterIndex,
  type OverlayRect,
} from "@/lib/books/dom-anchor";
import {
  createHighlightAction,
  deleteHighlightAction,
  updateHighlightAction,
  type BookHighlight,
  type HighlightColor,
} from "@/app/read/highlights";

/**
 * Highlights, drawn over the text rather than into it.
 *
 * Wrapping the selection in `<mark>` would split text nodes, and every anchor
 * in the reader — the saved reading position, the highlights themselves, the
 * page restore — is measured in offsets into those exact nodes. Mutating them
 * would silently move everything. So highlights are rectangles positioned in
 * the content's own coordinate space, which the page transform carries along
 * for free and which cost the document nothing.
 */

const COLORS: { key: HighlightColor; label: string; swatch: string; fill: string }[] = [
  { key: "yellow", label: "Yellow", swatch: "bg-amber-300", fill: "rgb(252 211 77 / 0.42)" },
  { key: "green", label: "Green", swatch: "bg-emerald-300", fill: "rgb(110 231 183 / 0.42)" },
  { key: "blue", label: "Blue", swatch: "bg-sky-300", fill: "rgb(125 211 252 / 0.42)" },
  { key: "pink", label: "Pink", swatch: "bg-pink-300", fill: "rgb(249 168 212 / 0.45)" },
];

const FILL = new Map(COLORS.map((c) => [c.key, c.fill]));

type Painted = { highlight: BookHighlight; rects: OverlayRect[] };

export function BookHighlightLayer({
  documentId,
  chapterIdx,
  contentEl,
  indexRef,
  layoutTick,
  highlights,
  onChange,
}: {
  documentId: string;
  chapterIdx: number;
  contentEl: HTMLElement | null;
  indexRef: React.RefObject<ChapterIndex | null>;
  /** Bumped by the reader after every relayout, so rects are re-measured. */
  layoutTick: number;
  highlights: BookHighlight[];
  onChange: (next: BookHighlight[]) => void;
}) {
  const [painted, setPainted] = useState<Painted[]>([]);
  const [draft, setDraft] = useState<{
    start: number;
    end: number;
    text: string;
    rect: OverlayRect;
  } | null>(null);
  const [editing, setEditing] = useState<{ highlight: BookHighlight; rect: OverlayRect } | null>(
    null,
  );
  const [noteDraft, setNoteDraft] = useState("");
  const noteRef = useRef<HTMLTextAreaElement>(null);

  const mine = useMemo(
    () => highlights.filter((h) => h.chapterIdx === chapterIdx),
    [highlights, chapterIdx],
  );

  /* ── paint ─────────────────────────────────────────────────────────── */

  useEffect(() => {
    const index = indexRef.current;
    if (!contentEl || !index || mine.length === 0) {
      setPainted([]);
      return;
    }
    const next: Painted[] = [];
    for (const highlight of mine) {
      const range = rangeForOffsets(index, highlight.startOffset, highlight.endOffset);
      if (!range) continue;
      const rects = rectsForRange(contentEl, range);
      if (rects.length > 0) next.push({ highlight, rects });
    }
    setPainted(next);
  }, [mine, contentEl, indexRef, layoutTick]);

  /* ── selecting ─────────────────────────────────────────────────────── */

  useEffect(() => {
    if (!contentEl) return;

    const read = () => {
      const index = indexRef.current;
      if (!index) return;
      const found = selectionOffsets(index, contentEl);
      setDraft(found);
      if (found) setEditing(null);
    };

    // pointerup rather than selectionchange: the latter fires continuously
    // while dragging, and a toolbar that follows the finger is unusable.
    const onPointerUp = () => window.setTimeout(read, 10);
    contentEl.addEventListener("pointerup", onPointerUp);
    return () => contentEl.removeEventListener("pointerup", onPointerUp);
  }, [contentEl, indexRef]);

  // Any page turn or reflow invalidates a floating toolbar's position.
  useEffect(() => {
    setDraft(null);
    setEditing(null);
  }, [layoutTick, chapterIdx]);

  const clearSelection = useCallback(() => {
    window.getSelection()?.removeAllRanges();
    setDraft(null);
  }, []);

  /* ── writing ───────────────────────────────────────────────────────── */

  const create = useCallback(
    async (color: HighlightColor, withNote: boolean) => {
      if (!draft) return;
      const r = await createHighlightAction({
        documentId,
        chapterIdx,
        startOffset: draft.start,
        endOffset: draft.end,
        text: draft.text,
        color,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      const created: BookHighlight = {
        id: r.id,
        chapterIdx,
        startOffset: draft.start,
        endOffset: draft.end,
        text: draft.text,
        note: null,
        color,
      };
      onChange([...highlights, created]);
      const rect = draft.rect;
      clearSelection();
      if (withNote) {
        setEditing({ highlight: created, rect });
        setNoteDraft("");
        window.setTimeout(() => noteRef.current?.focus(), 30);
      }
    },
    [draft, documentId, chapterIdx, highlights, onChange, clearSelection],
  );

  async function saveNote() {
    if (!editing) return;
    const note = noteDraft.trim();
    const r = await updateHighlightAction({ id: editing.highlight.id, note: note || null });
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    onChange(
      highlights.map((h) => (h.id === editing.highlight.id ? { ...h, note: note || null } : h)),
    );
    setEditing(null);
  }

  async function recolor(color: HighlightColor) {
    if (!editing) return;
    const r = await updateHighlightAction({ id: editing.highlight.id, color });
    if (!r.ok) return;
    onChange(highlights.map((h) => (h.id === editing.highlight.id ? { ...h, color } : h)));
    setEditing({ ...editing, highlight: { ...editing.highlight, color } });
  }

  async function remove() {
    if (!editing) return;
    const id = editing.highlight.id;
    setEditing(null);
    onChange(highlights.filter((h) => h.id !== id));
    const r = await deleteHighlightAction(id);
    if (!r.ok) toast.error(r.error);
  }

  /* ── render ────────────────────────────────────────────────────────── */

  return (
    <>
      {/* Rectangles sit under the text and take no pointer events except on
          their own bodies, so selecting across a highlight still works. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 z-0">
        {painted.map(({ highlight, rects }) =>
          rects.map((r, i) => (
            <button
              key={`${highlight.id}-${i}`}
              onClick={(e) => {
                e.stopPropagation();
                setEditing({ highlight, rect: rects[0] });
                setNoteDraft(highlight.note ?? "");
              }}
              title={highlight.note ?? "Highlight"}
              className="pointer-events-auto absolute rounded-[2px]"
              style={{
                left: r.left,
                top: r.top,
                width: r.width,
                height: r.height,
                background: FILL.get(highlight.color) ?? FILL.get("yellow"),
                // A highlight carrying a note earns a visible marker.
                boxShadow: highlight.note ? "inset 0 -2px 0 rgb(0 0 0 / 0.35)" : undefined,
              }}
            />
          )),
        )}
      </div>

      {/* Selection toolbar */}
      {draft && (
        <div
          className="pointer-events-auto absolute z-30 flex -translate-x-1/2 items-center gap-0.5 rounded-lg border border-border bg-popover p-1 shadow-lg"
          style={{
            left: draft.rect.left + draft.rect.width / 2,
            // Above the selection where there is room, below it otherwise.
            top: draft.rect.top > 56 ? draft.rect.top - 48 : draft.rect.top + draft.rect.height + 8,
          }}
          onPointerDown={(e) => e.preventDefault()}
        >
          {COLORS.map((c) => (
            <button
              key={c.key}
              onClick={() => void create(c.key, false)}
              title={`Highlight ${c.label.toLowerCase()}`}
              aria-label={`Highlight ${c.label.toLowerCase()}`}
              className={cn("h-7 w-7 rounded-md p-1 transition-transform active:scale-90")}
            >
              <span className={cn("block h-full w-full rounded", c.swatch)} />
            </button>
          ))}
          <span className="mx-0.5 h-5 w-px bg-border" />
          <button
            onClick={() => void create("yellow", true)}
            title="Highlight and add a note"
            aria-label="Highlight and add a note"
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <MessageSquarePlus className="h-4 w-4" />
          </button>
          <button
            onClick={clearSelection}
            title="Cancel"
            aria-label="Cancel"
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Editing an existing highlight */}
      {editing && (
        <div
          className="pointer-events-auto absolute z-30 w-[min(20rem,80vw)] -translate-x-1/2 rounded-lg border border-border bg-popover p-2 shadow-xl"
          style={{
            left: editing.rect.left + editing.rect.width / 2,
            top: editing.rect.top + editing.rect.height + 8,
          }}
        >
          <div className="mb-2 flex items-center gap-1">
            <Highlighter className="h-3.5 w-3.5 text-muted-foreground" />
            <div className="flex flex-1 items-center gap-0.5">
              {COLORS.map((c) => (
                <button
                  key={c.key}
                  onClick={() => void recolor(c.key)}
                  aria-label={c.label}
                  className={cn(
                    "h-5 w-5 rounded p-0.5",
                    editing.highlight.color === c.key && "ring-2 ring-foreground/60",
                  )}
                >
                  <span className={cn("block h-full w-full rounded-sm", c.swatch)} />
                </button>
              ))}
            </div>
            <button
              onClick={() => void remove()}
              title="Delete highlight"
              aria-label="Delete highlight"
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
            </button>
            <button
              onClick={() => setEditing(null)}
              title="Close"
              aria-label="Close"
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <textarea
            ref={noteRef}
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            onBlur={() => void saveNote()}
            placeholder="Add a note…"
            rows={3}
            className="w-full resize-none rounded-md border border-border bg-background p-2 text-sm outline-none focus:border-foreground/40"
          />
        </div>
      )}
    </>
  );
}
