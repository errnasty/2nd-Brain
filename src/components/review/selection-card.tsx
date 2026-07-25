"use client";

import { useCallback, useRef, useState } from "react";
import { Brain, Highlighter, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createCardsFromTextAction } from "@/app/(app)/review/actions";
import { addHighlight } from "@/lib/reader/highlights";

/**
 * Wraps reader content and floats actions over any text selection — turn the
 * passage into recall cards, or just mark it so it surfaces on re-read.
 * Selection-scoped so the rest of the page (headers, toolbars) doesn't trigger
 * it.
 *
 * The two actions sit at different costs: a flashcard is an AI call and a
 * commitment to review later; a highlight is free and local. Keeping both
 * means "this matters" doesn't have to mean "study this".
 */
export function SelectionToCard({
  sourceTitle,
  articleId,
  onHighlight,
  children,
}: {
  sourceTitle: string;
  /** Omit to hide the highlight action (highlights are stored per article). */
  articleId?: string;
  onHighlight?: (highlights: string[]) => void;
  children: React.ReactNode;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [sel, setSel] = useState<{ text: string; top: number; left: number } | null>(null);
  const [making, setMaking] = useState(false);

  const onPointerUp = useCallback(() => {
    // Selection isn't final until after the browser's default pointer-up
    // handling; read it a frame later.
    requestAnimationFrame(() => {
      const s = window.getSelection();
      const text = s?.toString().trim() ?? "";
      const wrap = wrapRef.current;
      if (!s || s.rangeCount === 0 || s.isCollapsed || text.length < 20 || !wrap) {
        setSel(null);
        return;
      }
      if (!wrap.contains(s.anchorNode) || !wrap.contains(s.focusNode)) {
        setSel(null);
        return;
      }
      const rect = s.getRangeAt(0).getBoundingClientRect();
      const wrapRect = wrap.getBoundingClientRect();
      setSel({
        text: text.slice(0, 4000),
        top: rect.top - wrapRect.top - 38,
        left: Math.max(0, rect.left - wrapRect.left + rect.width / 2 - 70),
      });
    });
  }, []);

  async function make() {
    if (!sel || making) return;
    setMaking(true);
    try {
      const res = await createCardsFromTextAction({ title: sourceTitle, text: sel.text });
      if (res.ok) {
        toast.success(`${res.count} flashcard${res.count === 1 ? "" : "s"} added from selection`);
        setSel(null);
        window.getSelection()?.removeAllRanges();
      } else {
        toast.error(res.error);
      }
    } catch {
      toast.error("Couldn't create flashcards");
    } finally {
      setMaking(false);
    }
  }

  function highlight() {
    if (!sel || !articleId) return;
    const next = addHighlight(articleId, sel.text);
    onHighlight?.(next);
    setSel(null);
    window.getSelection()?.removeAllRanges();
  }

  return (
    <div ref={wrapRef} className="relative" onMouseUp={onPointerUp} onTouchEnd={onPointerUp}>
      {children}
      {sel && (
        <div
          // preventDefault on mousedown so the click doesn't collapse the
          // selection before onClick fires.
          onMouseDown={(e) => e.preventDefault()}
          className="absolute z-20 flex items-center gap-1 rounded-full border border-border bg-card p-1 shadow-lg"
          style={{ top: sel.top, left: sel.left }}
        >
          <button
            onClick={make}
            disabled={making}
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors hover:bg-accent"
          >
            {making ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Brain className="h-3.5 w-3.5" style={{ color: "hsl(var(--brand))" }} />
            )}
            Make flashcard
          </button>
          {articleId && (
            <button
              onClick={highlight}
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Highlighter className="h-3.5 w-3.5" />
              Highlight
            </button>
          )}
        </div>
      )}
    </div>
  );
}
