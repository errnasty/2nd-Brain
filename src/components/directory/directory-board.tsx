"use client";

import { useEffect, useMemo } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { FileText, GripVertical, Newspaper, NotebookPen } from "lucide-react";
import { cn, formatRelativeTime } from "@/lib/utils";
import type { ReadingStatus } from "@/lib/directory/query";
import type { DirectoryListItem } from "./directory-shell";
import { useBoardOptimistic } from "./board-optimistic";

const COLUMNS: { id: ReadingStatus; label: string }[] = [
  { id: "inbox", label: "Inbox" },
  { id: "reading", label: "Reading" },
  { id: "done", label: "Done" },
  { id: "review", label: "Review" },
];

const KIND_ICON: Record<DirectoryListItem["kind"], React.ReactNode> = {
  saved_article: <Newspaper className="h-3 w-3" />,
  uploaded_document: <FileText className="h-3 w-3" />,
  user_note: <NotebookPen className="h-3 w-3" />,
};

/**
 * Reading pipeline Kanban. Cards are drag sources (id = item id); columns are
 * drop targets (id = `status:<col>`). The actual status update happens in the
 * route-level DndContext (DirectoryDndShell), which calls
 * updateReadingStatusAction and refreshes. Columns auto-sort by recency (the
 * incoming `items` are already updated_at desc).
 */
export function DirectoryBoard({
  items,
  selectedId,
  onOpen,
}: {
  items: DirectoryListItem[];
  selectedId: string | null;
  onOpen: (id: string) => void;
}) {
  const { overrides, revert } = useBoardOptimistic();

  // Apply pending optimistic moves so a just-dropped card shows in its target
  // column immediately, before the server confirm + router.refresh land.
  const effItems = useMemo(
    () =>
      items.map((i) =>
        overrides[i.id] && overrides[i.id] !== i.readingStatus
          ? { ...i, readingStatus: overrides[i.id] }
          : i,
      ),
    [items, overrides],
  );

  // Once refreshed server data already reflects a pending move, drop the
  // override so the map doesn't grow.
  useEffect(() => {
    for (const i of items) {
      if (overrides[i.id] && i.readingStatus === overrides[i.id]) revert(i.id);
    }
  }, [items, overrides, revert]);

  return (
    <div className="flex flex-1 gap-3 overflow-x-auto p-3">
      {COLUMNS.map((col) => (
        <BoardColumn
          key={col.id}
          status={col.id}
          label={col.label}
          items={effItems.filter((i) => i.readingStatus === col.id)}
          selectedId={selectedId}
          onOpen={onOpen}
        />
      ))}
    </div>
  );
}

function BoardColumn({
  status,
  label,
  items,
  selectedId,
  onOpen,
}: {
  status: ReadingStatus;
  label: string;
  items: DirectoryListItem[];
  selectedId: string | null;
  onOpen: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `status:${status}` });
  return (
    <div className="flex w-72 shrink-0 flex-col rounded-lg bg-muted/40">
      <div className="flex items-center justify-between px-3 py-2 font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
        <span>{label}</span>
        <span className="tabular-nums">{items.length}</span>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          "flex flex-1 flex-col gap-2 overflow-y-auto p-2 transition-colors",
          isOver && "bg-accent/40 ring-2 ring-primary ring-inset rounded-md",
        )}
      >
        {items.length === 0 ? (
          <div className="px-2 py-6 text-center text-xs italic text-muted-foreground">
            Drop here
          </div>
        ) : (
          items.map((item) => (
            <BoardCard
              key={item.id}
              item={item}
              selected={selectedId === item.id}
              onOpen={onOpen}
            />
          ))
        )}
      </div>
    </div>
  );
}

function BoardCard({
  item,
  selected,
  onOpen,
}: {
  item: DirectoryListItem;
  selected: boolean;
  onOpen: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: item.id });
  return (
    <div
      ref={setNodeRef}
      onClick={() => onOpen(item.id)}
      className={cn(
        "group relative cursor-pointer rounded-md border border-border bg-background p-2.5 pr-7 text-left shadow-sm transition-colors hover:bg-accent/50",
        selected && "ring-2 ring-primary",
        isDragging && "opacity-40",
      )}
    >
      {/* Dedicated drag handle. Only this (touch-action: none) starts a drag, so
          a vertical finger-swipe anywhere else still scrolls the column on touch. */}
      <button
        {...attributes}
        {...listeners}
        onClick={(e) => e.stopPropagation()}
        title="Drag to move"
        aria-label="Drag to move"
        className="absolute right-1 top-1 cursor-grab touch-none rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100 active:cursor-grabbing"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      <div className="mb-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">
        {KIND_ICON[item.kind]}
        <span>{formatRelativeTime(item.updatedAt)}</span>
      </div>
      <div className="line-clamp-2 text-sm font-medium leading-snug">{item.title}</div>
      {item.preview && (
        <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{item.preview}</div>
      )}
    </div>
  );
}
