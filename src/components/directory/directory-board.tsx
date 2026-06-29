"use client";

import { useEffect, useMemo, useState } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { Check, FileText, GripVertical, Newspaper, NotebookPen, Pencil, X } from "lucide-react";
import { cn, formatRelativeTime } from "@/lib/utils";
import { updateUserSettingsAction } from "@/lib/settings/actions";
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
  wipLimits = {},
}: {
  items: DirectoryListItem[];
  selectedId: string | null;
  onOpen: (id: string) => void;
  wipLimits?: Record<string, number>;
}) {
  const { overrides, revert } = useBoardOptimistic();

  // #10 WIP limits per column. Seeded from server settings; edits update locally
  // (optimistic) and persist via the user_settings store.
  const [limits, setLimits] = useState<Record<string, number>>(wipLimits);
  useEffect(() => setLimits(wipLimits), [wipLimits]);
  function setLimit(columnId: string, value: number | null) {
    // Compute the next map from current state, then persist OUTSIDE the updater
    // so the network write fires exactly once (a side effect inside a setState
    // updater double-fires under React StrictMode).
    const next = { ...limits };
    if (value && value > 0) next[columnId] = value;
    else delete next[columnId];
    setLimits(next);
    void updateUserSettingsAction({ wipLimits: next });
  }

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
          limit={limits[col.id] ?? null}
          onSetLimit={(v) => setLimit(col.id, v)}
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
  limit,
  onSetLimit,
}: {
  status: ReadingStatus;
  label: string;
  items: DirectoryListItem[];
  selectedId: string | null;
  onOpen: (id: string) => void;
  limit: number | null;
  onSetLimit: (value: number | null) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `status:${status}` });
  const avgAge = (() => {
    if (items.length === 0) return null;
    const now = Date.now();
    const ms = items.reduce((s, it) => s + (now - new Date(it.updatedAt).getTime()), 0) / items.length;
    const days = Math.floor(ms / 86_400_000);
    if (days >= 1) return `avg ${days}d`;
    const hrs = Math.floor(ms / 3_600_000);
    return `avg ${Math.max(1, hrs)}h`;
  })();
  const over = limit != null && items.length > limit;
  const atLimit = limit != null && items.length === limit;
  return (
    <div className="flex w-72 shrink-0 flex-col rounded-lg bg-muted/40">
      <div className="flex items-center justify-between px-3 py-2 font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
        <span>{label}</span>
        <span className="flex items-center gap-2">
          {avgAge && <span className="font-normal normal-case opacity-70">{avgAge}</span>}
          <WipCount count={items.length} limit={limit} over={over} atLimit={atLimit} onSetLimit={onSetLimit} />
        </span>
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

/** #10 Editable "count / limit" WIP badge. Click to set/clear a column limit. */
function WipCount({
  count,
  limit,
  over,
  atLimit,
  onSetLimit,
}: {
  count: number;
  limit: number | null;
  over: boolean;
  atLimit: boolean;
  onSetLimit: (value: number | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(limit != null ? String(limit) : "");

  if (editing) {
    return (
      <span className="flex items-center gap-1">
        <span className="tabular-nums">{count}</span>
        <span className="opacity-50">/</span>
        <input
          autoFocus
          type="number"
          min={0}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { onSetLimit(Number(value) || null); setEditing(false); }
            if (e.key === "Escape") setEditing(false);
          }}
          className="h-5 w-10 rounded border border-border bg-background px-1 text-[11px] tabular-nums outline-none"
        />
        <button
          onClick={() => { onSetLimit(Number(value) || null); setEditing(false); }}
          className="rounded p-0.5 hover:bg-accent"
          title="Save limit"
        >
          <Check className="h-3 w-3" />
        </button>
        {limit != null && (
          <button
            onClick={() => { onSetLimit(null); setValue(""); setEditing(false); }}
            className="rounded p-0.5 hover:bg-accent"
            title="Remove limit"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </span>
    );
  }

  return (
    <button
      onClick={() => { setValue(limit != null ? String(limit) : ""); setEditing(true); }}
      title={limit != null ? "Edit WIP limit" : "Set a WIP limit"}
      className={cn(
        "group/wip flex items-center gap-1 rounded px-1 tabular-nums hover:bg-accent",
        over && "text-destructive",
        atLimit && !over && "text-brand",
      )}
    >
      <span>{count}</span>
      {limit != null && <><span className="opacity-50">/</span><span>{limit}</span></>}
      <Pencil className="h-2.5 w-2.5 opacity-0 transition-opacity group-hover/wip:opacity-60" />
    </button>
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
