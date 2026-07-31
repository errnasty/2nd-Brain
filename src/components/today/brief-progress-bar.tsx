"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * The Daily Brief's reading-progress bar: one segment per desk, pinned to the
 * top of the page, filling as you scroll.
 *
 * ## Why segmented rather than one bar
 *
 * The Feeds reader's strip answers "how far through this article am I", which
 * is one question because an article is one thing. The brief is a stack of
 * desks, and the useful question is "which desks have I got through" — a
 * single bar at 60% tells you nothing about whether you've read Geopolitics.
 * So there's one segment per section, and each fills independently.
 *
 * ## Why the segments aren't equal width
 *
 * Their widths are proportional to how tall each section actually is, which
 * makes the bar a true map of the document: a desk that's twice the reading
 * gets twice the bar. Equal widths would put a two-line "Quick clear" on the
 * same footing as a six-bullet desk and make the position indicator lie about
 * where you are.
 *
 * ## Scroll, not visibility
 *
 * The fill is driven by scroll position rather than by the read/dwell state
 * that drives XP. They answer different questions — "where am I" versus "what
 * counted" — and conflating them would mean the bar only moved in 3-second
 * jumps. The two are shown together: fill is where you've scrolled, the
 * brand-coloured underline marks the sections that actually counted as read.
 */

export type ProgressSection = {
  key: string;
  label: string;
  /** Whether this section has been dwelt on long enough to count as read. */
  read: boolean;
};

type Measured = {
  key: string;
  label: string;
  read: boolean;
  /** Share of total document height, 0–1 — the segment's width. */
  weight: number;
  /** How much of this section has been scrolled past, 0–1. */
  fill: number;
};

/** Below this the bar is noise — a brief with one section is just a page. */
const MIN_SECTIONS = 2;

export function BriefProgressBar({
  sections,
  /** The scrolling element the brief lives in. */
  scrollRef,
  /** Resolves a section key to its rendered element. */
  getSectionEl,
}: {
  sections: ProgressSection[];
  scrollRef: React.RefObject<HTMLElement | null>;
  getSectionEl: (key: string) => HTMLElement | null;
}) {
  const [measured, setMeasured] = useState<Measured[]>([]);
  const [overall, setOverall] = useState(0);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root || sections.length < MIN_SECTIONS) {
      setMeasured([]);
      return;
    }

    let raf = 0;

    const measure = () => {
      raf = 0;
      const rootRect = root.getBoundingClientRect();
      const viewportBottom = rootRect.height;

      const boxes = sections.map((s) => {
        const el = getSectionEl(s.key);
        if (!el) return { ...s, top: 0, height: 0 };
        const rect = el.getBoundingClientRect();
        return {
          ...s,
          // Relative to the scroll container's viewport, not the page.
          top: rect.top - rootRect.top,
          height: rect.height,
        };
      });

      const total = boxes.reduce((sum, b) => sum + b.height, 0);
      if (total <= 0) {
        setMeasured([]);
        return;
      }

      setMeasured(
        boxes.map((b) => ({
          key: b.key,
          label: b.label,
          read: b.read,
          weight: b.height / total,
          // How far the bottom of the viewport has travelled into this
          // section. Sections above the fold read as 1, below as 0.
          fill:
            b.height <= 0
              ? 0
              : Math.max(0, Math.min(1, (viewportBottom - b.top) / b.height)),
        })),
      );

      const max = root.scrollHeight - root.clientHeight;
      setOverall(max > 0 ? Math.max(0, Math.min(1, root.scrollTop / max)) : 0);
    };

    const onScroll = () => {
      // One measure per frame. Without this a fast flick runs getBoundingClientRect
      // over every section on every scroll event, which is a layout thrash.
      if (raf) return;
      raf = requestAnimationFrame(measure);
    };

    measure();
    root.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);

    // Sections stream in and grow as they're written, so the geometry changes
    // without any scrolling at all — re-measure when it does.
    const observer =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(onScroll) : null;
    if (observer) {
      for (const s of sections) {
        const el = getSectionEl(s.key);
        if (el) observer.observe(el);
      }
    }

    return () => {
      if (raf) cancelAnimationFrame(raf);
      root.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      observer?.disconnect();
    };
  }, [sections, scrollRef, getSectionEl]);

  if (measured.length < MIN_SECTIONS) return null;

  const readCount = measured.filter((m) => m.read).length;

  return (
    <div
      className="sticky top-0 z-30 -mx-1 mb-6 border-b border-border/50 bg-background/90 px-1 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/75"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(overall * 100)}
      aria-label={`Brief reading progress: ${readCount} of ${measured.length} desks read`}
    >
      <div className="flex items-center gap-[3px]">
        {measured.map((m) => (
          <div
            key={m.key}
            className="group/seg relative h-1.5 min-w-[8px] overflow-hidden rounded-full bg-foreground/10"
            style={{ flexGrow: Math.max(m.weight, 0.02), flexBasis: 0 }}
            title={`${m.label}${m.read ? " · read" : ""}`}
          >
            <div
              className={cn(
                "h-full rounded-full transition-[width] duration-150 ease-out",
                // Read sections stay brand-coloured; merely scrolled-past ones
                // are muted, so the bar distinguishes "I went past this" from
                // "this counted".
                m.read ? "bg-brand" : "bg-foreground/35",
              )}
              style={{ width: `${m.fill * 100}%` }}
            />
          </div>
        ))}
      </div>
      {/* Labels only where there's room; the bar itself carries the meaning on
          narrow screens, and titles cover the rest. */}
      <div className="mt-1 hidden items-center gap-[3px] sm:flex">
        {measured.map((m) => (
          <div
            key={m.key}
            className="min-w-0 truncate text-[10px] leading-tight text-muted-foreground"
            style={{ flexGrow: Math.max(m.weight, 0.02), flexBasis: 0 }}
          >
            <span className={cn("truncate", m.read && "text-brand")}>{m.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
