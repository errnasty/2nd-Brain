"use client";

import { useCallback, useRef, useState } from "react";
import { Brain, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createCardsFromTextAction } from "@/app/(app)/review/actions";

/**
 * Wraps reader content and floats a "Make flashcard" button over any text
 * selection — highlight a passage, one click, and the AI turns it into
 * recall cards in the review deck. Selection-scoped so the rest of the page
 * (headers, toolbars) doesn't trigger it.
 */
export function SelectionToCard({
  sourceTitle,
  children,
}: {
  sourceTitle: string;
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

  return (
    <div ref={wrapRef} className="relative" onMouseUp={onPointerUp} onTouchEnd={onPointerUp}>
      {children}
      {sel && (
        <button
          // preventDefault on mousedown so the click doesn't collapse the
          // selection before onClick fires.
          onMouseDown={(e) => e.preventDefault()}
          onClick={make}
          disabled={making}
          className="absolute z-20 inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium shadow-lg transition-colors hover:bg-accent"
          style={{ top: sel.top, left: sel.left }}
        >
          {making ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Brain className="h-3.5 w-3.5" style={{ color: "hsl(var(--brand))" }} />
          )}
          Make flashcard
        </button>
      )}
    </div>
  );
}
