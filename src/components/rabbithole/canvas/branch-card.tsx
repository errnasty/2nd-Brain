"use client";

import * as React from "react";
import { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChevronDown, ChevronRight, GripHorizontal, Loader2, PanelRight, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

export const CARD_W = 340;

/** One card in the canvas world. Root (`isRoot`) shows the source document;
 *  branches show the streamed answer. Position is applied by the parent via
 *  absolute left/top. The header is the drag handle. */
export function BranchCard({
  id,
  isRoot,
  title,
  anchorText,
  question,
  content,
  streaming,
  collapsed,
  childCount,
  onMeasure,
  onDragStart,
  onToggleCollapse,
  onOpenInSplit,
  onDelete,
  cardRef,
  bodyRef,
}: {
  id: string;
  isRoot: boolean;
  title: string;
  anchorText?: string;
  question?: string;
  content: string;
  streaming?: boolean;
  collapsed?: boolean;
  childCount: number;
  onMeasure: (id: string, w: number, h: number) => void;
  onDragStart: (id: string, e: React.PointerEvent) => void;
  onToggleCollapse?: (id: string) => void;
  onOpenInSplit?: (id: string) => void;
  onDelete?: (id: string) => void;
  cardRef: (id: string, el: HTMLDivElement | null) => void;
  bodyRef: (id: string, el: HTMLDivElement | null) => void;
}) {
  const localRef = useRef<HTMLDivElement | null>(null);

  // Report measured size to the layout engine whenever content changes.
  useEffect(() => {
    const el = localRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      onMeasure(id, el.offsetWidth, el.offsetHeight);
    });
    ro.observe(el);
    onMeasure(id, el.offsetWidth, el.offsetHeight);
    return () => ro.disconnect();
  }, [id, onMeasure, content, collapsed]);

  return (
    <div
      ref={(el) => {
        localRef.current = el;
        cardRef(id, el);
      }}
      className={cn(
        "absolute flex flex-col rounded-lg border bg-card shadow-sm",
        isRoot ? "border-primary/40" : "border-border",
      )}
      style={{ width: CARD_W }}
      data-card={id}
    >
      <div
        className="flex cursor-grab items-center gap-1.5 rounded-t-lg border-b border-border bg-muted/40 px-2 py-1.5 active:cursor-grabbing"
        onPointerDown={(e) => onDragStart(id, e)}
      >
        <GripHorizontal className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate text-xs font-semibold" title={title}>
          {title}
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          {childCount > 0 && onToggleCollapse && (
            <button
              onClick={() => onToggleCollapse(id)}
              className="rounded p-0.5 text-muted-foreground hover:text-foreground"
              title={collapsed ? `Expand ${childCount} branch${childCount === 1 ? "" : "es"}` : "Collapse"}
            >
              {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
          )}
          {onOpenInSplit && (
            <button
              onClick={() => onOpenInSplit(id)}
              className="rounded p-0.5 text-muted-foreground hover:text-foreground"
              title="Open in split view"
            >
              <PanelRight className="h-3.5 w-3.5" />
            </button>
          )}
          {!isRoot && onDelete && (
            <button
              onClick={() => onDelete(id)}
              className="rounded p-0.5 text-muted-foreground hover:text-destructive"
              title="Delete branch (and everything below it)"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <div
        ref={(el) => bodyRef(id, el)}
        className="max-h-[420px] overflow-y-auto px-3 py-2"
      >
        {!isRoot && anchorText && (
          <blockquote className="mb-2 border-l-2 border-primary/40 pl-2 text-xs italic text-muted-foreground">
            {anchorText.length > 200 ? `${anchorText.slice(0, 200)}…` : anchorText}
          </blockquote>
        )}
        {!isRoot && question && <div className="mb-2 text-xs font-medium">{question}</div>}
        <div className="prose-reader prose-sm max-w-none text-sm">
          {content ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          ) : streaming ? (
            <span className="inline-flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Digging…
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
