"use client";

import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { extractHeadings, wordStats } from "@/lib/notes/markdown";

/**
 * Heading map for the note being read or written.
 *
 * Headings come from the markdown source rather than the DOM, so the outline is
 * identical in preview and edit mode — in edit mode there is no rendered `h2`
 * to scrape.
 *
 * Takes elements rather than refs on purpose: child effects run before parent
 * effects, so a ref the parent fills in would still read null on first paint.
 */
export function NoteOutline({
  content,
  mode,
  bodyEl,
  scrollEl,
  variant = "rail",
  onNavigate,
  className,
}: {
  content: string;
  mode: "preview" | "edit";
  /** Wraps the rendered markdown (preview) or the editor (edit). */
  bodyEl: HTMLElement | null;
  /** The scrolling viewport — the scroll-spy root. */
  scrollEl: HTMLElement | null;
  variant?: "rail" | "panel";
  /** Called after a jump — lets a popover close itself. */
  onNavigate?: () => void;
  className?: string;
}) {
  const headings = useMemo(() => extractHeadings(content), [content]);
  const stats = useMemo(() => wordStats(content), [content]);
  const [active, setActive] = useState<string | null>(null);

  // Scroll-spy. Only meaningful in preview: edit mode has no anchored headings.
  useEffect(() => {
    if (mode !== "preview" || !bodyEl || !scrollEl || headings.length === 0) {
      setActive(null);
      return;
    }
    const targets = bodyEl.querySelectorAll<HTMLElement>("[data-note-heading]");
    if (targets.length === 0) return;

    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (hit) setActive(hit.target.getAttribute("data-note-heading"));
      },
      // Only the top third of the viewport counts as "where you are reading".
      { root: scrollEl, rootMargin: "0px 0px -70% 0px", threshold: 0 },
    );
    targets.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [mode, content, headings.length, bodyEl, scrollEl]);

  function jump(slug: string, line: number) {
    if (!bodyEl) return;

    if (mode === "preview") {
      bodyEl
        .querySelector<HTMLElement>(`[data-note-heading="${CSS.escape(slug)}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    } else {
      // CodeMirror renders one `.cm-line` per source line even with wrapping on,
      // so the heading's line number indexes straight into them.
      bodyEl.querySelectorAll<HTMLElement>(".cm-line")[line - 1]?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }
    setActive(slug);
    onNavigate?.();
  }

  return (
    <nav
      aria-label="Note outline"
      className={cn(
        "flex flex-col gap-2 text-sm",
        variant === "rail" && "h-full w-56 shrink-0 overflow-y-auto border-l border-border px-3 py-6",
        variant === "panel" && "max-h-[60vh] w-64 overflow-y-auto p-2",
        className,
      )}
    >
      <div className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">Outline</div>

      {headings.length > 0 ? (
        <ul className="space-y-0.5">
          {headings.map((h) => (
            <li key={h.slug}>
              <button
                onClick={() => jump(h.slug, h.line)}
                className={cn(
                  "block w-full truncate rounded py-1 pr-2 text-left text-[13px] leading-snug transition-colors hover:bg-accent/60",
                  active === h.slug ? "bg-accent/70 font-medium text-foreground" : "text-muted-foreground",
                )}
                style={{ paddingLeft: `${0.5 + (Math.min(h.level, 4) - 1) * 0.65}rem` }}
                title={h.text}
              >
                {h.text}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-2 text-[13px] italic text-muted-foreground">
          No headings yet — start a line with <code className="not-italic">##</code>.
        </p>
      )}

      <div className="mt-auto border-t border-border pt-2 font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
        {stats.words.toLocaleString()} {stats.words === 1 ? "word" : "words"}
        {stats.minutes > 0 && <> · {stats.minutes} min</>}
      </div>
    </nav>
  );
}
