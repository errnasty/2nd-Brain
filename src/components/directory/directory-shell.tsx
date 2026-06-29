"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useDraggable } from "@dnd-kit/core";
import { ArrowDownUp, Brain, ChevronLeft, Check, FileText, GraduationCap, GripVertical, LayoutGrid, Lightbulb, List, Newspaper, NotebookPen, Pencil, Plus, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn, formatRelativeTime } from "@/lib/utils";
import {
  createNoteAction,
  fetchDirectoryItemByIdAction,
  loadMoreDirectoryItemsAction,
  renameDirectoryFolderAction,
  uploadToDirectoryAction,
} from "@/app/(app)/directory/actions";
import { DIRECTORY_PAGE_SIZE } from "@/lib/directory/constants";
import { maxUploadBytes, maxUploadLabel } from "@/lib/upload-limits";
import { toast } from "sonner";
import { ItemViewer } from "./item-viewer";
import { BulkActionBar } from "./bulk-action-bar";
import { DirectoryBoard } from "./directory-board";
import { GapsDialog } from "./gaps-dialog";
import { CurriculumDialog } from "./curriculum-dialog";
import { useShortcuts } from "@/components/reader/use-shortcuts";
import type { DirectoryFolder } from "@/lib/db/schema";
import type { ReadingStatus, DirectorySort } from "@/lib/directory/query";

export type DirectoryListItem = {
  id: string;
  title: string;
  preview: string | null;
  kind: "saved_article" | "uploaded_document" | "user_note";
  folderId: string | null;
  sourceUrl: string | null;
  articleId: string | null;
  documentId: string | null;
  readingStatus: ReadingStatus;
  createdAt: Date;
  updatedAt: Date;
};

const KIND_META: Record<DirectoryListItem["kind"], { label: string; icon: React.ReactNode }> = {
  saved_article: { label: "Article", icon: <Newspaper className="h-3 w-3" /> },
  uploaded_document: { label: "Document", icon: <FileText className="h-3 w-3" /> },
  user_note: { label: "Note", icon: <NotebookPen className="h-3 w-3" /> },
};

export function DirectoryShell({
  items,
  itemTagsById,
  hasMore,
  folders,
  activeFolder,
  activeTagIds,
  activeSort = "updated",
  wipLimits = {},
}: {
  items: DirectoryListItem[];
  itemTagsById: Record<string, string[]>;
  hasMore: boolean;
  folders: DirectoryFolder[];
  activeFolder: string | null;
  activeTagIds: string[];
  activeSort?: DirectorySort;
  wipLimits?: Record<string, number>;
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [view, setView] = useState<"list" | "board">("list");
  const [gapsOpen, setGapsOpen] = useState(false);
  const [curriculumOpen, setCurriculumOpen] = useState(false);
  const [, startTransition] = useTransition();

  const [extraItems, setExtraItems] = useState<DirectoryListItem[]>([]);
  const [extraTags, setExtraTags] = useState<Record<string, string[]>>({});
  const [pageHasMore, setPageHasMore] = useState(hasMore);
  const [offset, setOffset] = useState(items.length);
  const [loadingMore, setLoadingMore] = useState(false);

  const seedSig = `${activeFolder ?? ""}|${activeTagIds.join(",")}|${activeSort}|${items.length}|${items[0]?.id ?? ""}|${items[0]?.updatedAt ?? ""}`;
  useEffect(() => {
    setExtraItems([]);
    setExtraTags({});
    setPageHasMore(hasMore);
    setOffset(items.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedSig]);

  const allItems = useMemo(() => [...items, ...extraItems], [items, extraItems]);
  const allTags = useMemo(() => ({ ...itemTagsById, ...extraTags }), [itemTagsById, extraTags]);

  // #13 Client-side filter strip (type + age) over the loaded items.
  const [typeFilter, setTypeFilter] = useState<"all" | DirectoryListItem["kind"]>("all");
  const [ageFilter, setAgeFilter] = useState<"any" | "7d" | "30d" | "90d">("any");
  const filteredItems = useMemo(() => {
    const now = Date.now();
    const DAY = 86_400_000;
    const maxAgeMs =
      ageFilter === "7d" ? 7 * DAY : ageFilter === "30d" ? 30 * DAY : ageFilter === "90d" ? 90 * DAY : Infinity;
    return allItems.filter((i) => {
      if (typeFilter !== "all" && i.kind !== typeFilter) return false;
      if (maxAgeMs !== Infinity && now - new Date(i.createdAt).getTime() > maxAgeMs) return false;
      return true;
    });
  }, [allItems, typeFilter, ageFilter]);

  const loadMore = useCallback(() => {
    if (loadingMore || !pageHasMore) return;
    setLoadingMore(true);
    startTransition(async () => {
      try {
        const r = await loadMoreDirectoryItemsAction({
          folder: activeFolder,
          tagIds: activeTagIds,
          offset,
          limit: DIRECTORY_PAGE_SIZE,
          sort: activeSort,
        });
        setExtraItems((prev) => [...prev, ...(r.items as DirectoryListItem[])]);
        setExtraTags((prev) => ({ ...prev, ...r.itemTagsById }));
        setPageHasMore(r.hasMore);
        setOffset((o) => o + r.items.length);
      } finally {
        setLoadingMore(false);
      }
    });
  }, [loadingMore, pageHasMore, activeFolder, activeTagIds, activeSort, offset]);

  useEffect(() => {
    if (view === "board" && pageHasMore && !loadingMore) loadMore();
  }, [view, pageHasMore, loadingMore, loadMore]);

  useEffect(() => {
    setCheckedIds(new Set());
  }, [activeFolder, activeTagIds.join(",")]);

  const toggleChecked = useCallback((id: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setCheckedIds(new Set()), []);

  const urlItem = useSearchParams().get("item");
  useEffect(() => {
    setSelectedId(urlItem);
  }, [urlItem]);

  const [hydratedItem, setHydratedItem] = useState<DirectoryListItem | null>(null);

  useEffect(() => {
    if (!selectedId) {
      setHydratedItem(null);
      return;
    }
    if (allItems.some((i) => i.id === selectedId)) {
      setHydratedItem(null);
      return;
    }
    if (hydratedItem?.id === selectedId) return;
    let cancelled = false;
    fetchDirectoryItemByIdAction(selectedId)
      .then((item) => {
        if (cancelled) return;
        if (item) {
          setHydratedItem(item as DirectoryListItem);
        } else {
          setSelectedId(null);
          const url = new URL(window.location.href);
          url.searchParams.delete("item");
          window.history.replaceState(null, "", url.toString());
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [allItems, selectedId, hydratedItem]);

  const selectItem = useCallback((id: string | null) => {
    setSelectedId(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("item", id);
    else url.searchParams.delete("item");
    window.history.replaceState(null, "", url.toString());
  }, []);

  const moveSelection = useCallback(
    (delta: number) => {
      if (allItems.length === 0) return;
      const idx = allItems.findIndex((i) => i.id === selectedId);
      const next = idx < 0 ? 0 : Math.min(allItems.length - 1, Math.max(0, idx + delta));
      selectItem(allItems[next].id);
    },
    [allItems, selectedId, selectItem],
  );
  useShortcuts({ escape: () => selectItem(null) });
  useShortcuts(
    {
      j: () => moveSelection(1),
      k: () => moveSelection(-1),
      arrowdown: () => moveSelection(1),
      arrowup: () => moveSelection(-1),
    },
    !selectedId,
  );

  const targetFolderId = activeFolder && activeFolder !== "unsorted" ? activeFolder : null;

  function newNote() {
    startTransition(async () => {
      const r = await createNoteAction({
        title: "Untitled note",
        content: "",
        folderId: targetFolderId,
      });
      if (r.ok) {
        toast.success("Note created");
        selectItem(r.itemId);
      } else {
        toast.error(r.error);
      }
    });
  }

  function onFilesPicked(files: FileList) {
    const max = maxUploadBytes();
    Array.from(files).forEach((file) => {
      if (file.size > max) {
        toast.error(`${file.name} is ${(file.size / 1024 / 1024).toFixed(1)}MB — over the ${maxUploadLabel()} limit.`);
        return;
      }
      const fd = new FormData();
      fd.set("file", file);
      if (targetFolderId) fd.set("folderId", targetFolderId);
      startTransition(async () => {
        const r = await uploadToDirectoryAction(fd);
        if (r.ok) toast.success(`${file.name} uploaded`);
        else toast.error(`${file.name}: ${r.error}`);
      });
    });
  }

  const selectedItem = useMemo(
    () =>
      allItems.find((i) => i.id === selectedId) ??
      (hydratedItem?.id === selectedId ? hydratedItem : null),
    [allItems, selectedId, hydratedItem],
  );

  const folderName = useMemo(() => {
    if (activeTagIds.length > 0) return "Tagged";
    if (activeFolder === "unsorted") return "Unsorted";
    if (activeFolder) {
      return folders.find((f) => f.id === activeFolder)?.name ?? "Folder";
    }
    return "All items";
  }, [folders, activeFolder, activeTagIds]);

  const countLabel = `${allItems.length}${pageHasMore ? "+" : ""}`;
  const headerMeta = activeTagIds.length > 0
    ? "Tag filter"
    : activeFolder === "unsorted"
      ? "Items without a folder"
      : activeFolder
        ? "Folder pipeline"
        : "Your knowledge library";

  // Inline folder rename from the header (real folders only).
  const canRename = !!activeFolder && activeFolder !== "unsorted" && activeTagIds.length === 0;
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  // Escape unmounts the input which fires onBlur → commit; this ref makes the
  // resulting commit a no-op so Escape truly cancels.
  const renameCancelled = useRef(false);
  function startRename() {
    renameCancelled.current = false;
    setRenameValue(folderName);
    setRenaming(true);
  }
  function commitRename() {
    setRenaming(false);
    if (renameCancelled.current) {
      renameCancelled.current = false;
      return;
    }
    const name = renameValue.trim();
    if (!canRename || !activeFolder || !name || name === folderName) return;
    startTransition(async () => {
      const r = await renameDirectoryFolderAction(activeFolder, name);
      if (r.ok) router.refresh();
      else toast.error(r.error);
    });
  }

  return (
    <>
      <section
        className={cn(
          "w-full flex-col border-r border-border md:flex",
          view === "board" ? "flex-1" : "md:max-w-sm md:shrink-0",
          selectedId ? "hidden" : "flex",
        )}
      >
        {/* ── Editorial header ───────────────────────────────────── */}
        <header className="border-b border-border px-4 pb-3 pt-4">
          <div className="mb-1.5 flex items-center gap-1.5 editorial-eyebrow">
            {/* Mobile back */}
            <button
              onClick={() => router.push("/directory")}
              className="-ml-0.5 hover:text-foreground md:hidden"
              title="Folders"
            >
              <ChevronLeft className="h-3 w-3" />
            </button>
            <span>Directory · {headerMeta}</span>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            {renaming ? (
              <input
                autoFocus
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); commitRename(); }
                  if (e.key === "Escape") { renameCancelled.current = true; setRenaming(false); }
                }}
                className="editorial-display m-0 min-w-0 flex-1 border-b border-primary bg-transparent outline-none"
                style={{ fontSize: "1.35rem", letterSpacing: "-0.018em" }}
              />
            ) : (
              <button
                type="button"
                onClick={canRename ? startRename : undefined}
                title={canRename ? "Rename folder" : undefined}
                className={cn(
                  "group/title flex min-w-0 items-baseline gap-1.5 text-left",
                  canRename ? "cursor-text" : "cursor-default",
                )}
              >
                <h2
                  className="editorial-display m-0 truncate"
                  style={{ fontSize: "1.35rem", letterSpacing: "-0.018em" }}
                >
                  {folderName}
                </h2>
                {canRename && (
                  <Pencil className="h-3 w-3 shrink-0 self-center text-muted-foreground opacity-0 transition-opacity group-hover/title:opacity-100" />
                )}
              </button>
            )}
            <span className="shrink-0 font-mono text-[10px] tabular-nums" style={{ color: "hsl(var(--brand))" }}>
              {countLabel} items
            </span>
          </div>
        </header>

        <div className="flex items-center justify-between px-3 py-2">
          <div className="flex items-center rounded-md border border-border p-0.5">
            <button
              onClick={() => setView("list")}
              title="List view"
              className={cn(
                "rounded p-1 transition-colors",
                view === "list"
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <List className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setView("board")}
              title="Board view (reading pipeline)"
              className={cn(
                "rounded p-1 transition-colors",
                view === "board"
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
            </button>
          </div>
          <SortControls active={activeSort} />
          <div className="flex items-center gap-0.5">
            {activeFolder && activeFolder !== "unsorted" && (
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={() => router.push(`/study?tab=review&folder=${activeFolder}`)}
                title="Study this folder (review its due flashcards)"
              >
                <Brain className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={() => setCurriculumOpen(true)}
              title="Generate curriculum"
            >
              <GraduationCap className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={() => setGapsOpen(true)}
              title="Find knowledge gaps"
            >
              <Lightbulb className="h-3.5 w-3.5" />
            </Button>
            <UploadButton onPick={onFilesPicked} />
            <Button
              size="icon"
              variant="brand"
              className="h-7 w-7"
              onClick={newNote}
              title="New note"
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        <div className="h-px bg-border" />
        {allItems.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            <FileText className="h-8 w-8 text-muted-foreground/40" />
            <p className="editorial-display text-base">
              {activeTagIds.length > 0 ? "Nothing matches" : "Empty shelf"}
            </p>
            <p className="max-w-xs text-xs italic text-muted-foreground">
              {activeTagIds.length > 0
                ? "No items match the selected tags."
                : "Create a note, upload a PDF, or save articles from your feeds."}
            </p>
          </div>
        ) : (
          <>
            <FilterStrip
              typeFilter={typeFilter}
              onType={setTypeFilter}
              ageFilter={ageFilter}
              onAge={setAgeFilter}
              hasTagFilter={activeTagIds.length > 0}
              onClearTags={() => {
                const sp = new URLSearchParams();
                if (activeFolder) sp.set("folder", activeFolder);
                if (activeSort !== "updated") sp.set("sort", activeSort);
                router.push(`/directory${sp.toString() ? `?${sp.toString()}` : ""}`, { scroll: false });
              }}
              shown={filteredItems.length}
              total={allItems.length}
            />
            {filteredItems.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
                <p className="text-sm italic text-muted-foreground">No items match these filters.</p>
                <Button size="sm" variant="ghost" onClick={() => { setTypeFilter("all"); setAgeFilter("any"); }}>
                  Reset filters
                </Button>
              </div>
            ) : view === "board" ? (
              <DirectoryBoard
                items={filteredItems}
                selectedId={selectedId}
                onOpen={selectItem}
                wipLimits={wipLimits}
              />
            ) : (
              <VirtualizedDirectoryList
                items={filteredItems}
                itemTagsById={allTags}
                selectedId={selectedId}
                checkedIds={checkedIds}
                onCheck={toggleChecked}
                onOpen={selectItem}
                onReachEnd={loadMore}
                loadingMore={loadingMore}
                hasMore={pageHasMore}
              />
            )}
          </>
        )}
      </section>

      <ItemViewer
        item={selectedItem}
        onClose={() => selectItem(null)}
      />

      <BulkActionBar
        selectedIds={Array.from(checkedIds)}
        folders={folders}
        onClear={clearSelection}
      />

      <GapsDialog
        open={gapsOpen}
        onOpenChange={setGapsOpen}
        folder={activeFolder}
        tagIds={activeTagIds}
      />

      <CurriculumDialog
        open={curriculumOpen}
        onOpenChange={setCurriculumOpen}
        folder={activeFolder}
      />
    </>
  );
}

const TYPE_FILTERS: { id: "all" | DirectoryListItem["kind"]; label: string }[] = [
  { id: "all", label: "All" },
  { id: "saved_article", label: "Articles" },
  { id: "uploaded_document", label: "Docs" },
  { id: "user_note", label: "Notes" },
];
const AGE_LABELS: Record<"any" | "7d" | "30d" | "90d", string> = {
  any: "Any time",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
};

/** #13 Filter chips strip: type segmented chips + age dropdown + tag-filter pill + count. */
function FilterStrip({
  typeFilter,
  onType,
  ageFilter,
  onAge,
  hasTagFilter,
  onClearTags,
  shown,
  total,
}: {
  typeFilter: "all" | DirectoryListItem["kind"];
  onType: (v: "all" | DirectoryListItem["kind"]) => void;
  ageFilter: "any" | "7d" | "30d" | "90d";
  onAge: (v: "any" | "7d" | "30d" | "90d") => void;
  hasTagFilter: boolean;
  onClearTags: () => void;
  shown: number;
  total: number;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
      <div className="inline-flex rounded-md border border-border p-0.5">
        {TYPE_FILTERS.map((t) => (
          <button
            key={t.id}
            onClick={() => onType(t.id)}
            className={cn(
              "rounded px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide transition-colors",
              typeFilter === t.id ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <select
        value={ageFilter}
        onChange={(e) => onAge(e.target.value as "any" | "7d" | "30d" | "90d")}
        className="h-7 rounded-md border border-border bg-background px-1.5 text-xs outline-none"
        aria-label="Filter by date added"
      >
        {(Object.keys(AGE_LABELS) as (keyof typeof AGE_LABELS)[]).map((k) => (
          <option key={k} value={k}>{AGE_LABELS[k]}</option>
        ))}
      </select>
      {hasTagFilter && (
        <button
          onClick={onClearTags}
          className="inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-foreground hover:bg-accent/70"
          title="Clear tag filter"
        >
          Tag filter <X className="h-3 w-3" />
        </button>
      )}
      <span className="ml-auto font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
        Showing {shown} of {total}
      </span>
    </div>
  );
}

function VirtualizedDirectoryList({
  items,
  itemTagsById,
  selectedId,
  checkedIds,
  onCheck,
  onOpen,
  onReachEnd,
  loadingMore,
  hasMore,
}: {
  items: DirectoryListItem[];
  itemTagsById: Record<string, string[]>;
  selectedId: string | null;
  checkedIds: Set<string>;
  onCheck: (id: string) => void;
  onOpen: (id: string | null) => void;
  onReachEnd: () => void;
  loadingMore: boolean;
  hasMore: boolean;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 96,
    overscan: 6,
    measureElement: (el) => el.getBoundingClientRect().height,
  });

  const virtualRows = virtualizer.getVirtualItems();
  const lastIndex = virtualRows.length > 0 ? virtualRows[virtualRows.length - 1].index : 0;
  useEffect(() => {
    if (hasMore && !loadingMore && lastIndex >= items.length - 5) {
      onReachEnd();
    }
  }, [lastIndex, hasMore, loadingMore, items.length, onReachEnd]);

  return (
    <div ref={parentRef} className="flex-1 overflow-y-auto">
      <div
        className="relative w-full divide-y divide-border"
        style={{ height: `${virtualizer.getTotalSize()}px` }}
      >
        {virtualRows.map((row) => {
          const item = items[row.index];
          return (
            <div
              key={item.id}
              data-index={row.index}
              ref={virtualizer.measureElement}
              className="absolute left-0 top-0 w-full"
              style={{ transform: `translateY(${row.start}px)` }}
            >
              <DraggableItemRow
                item={item}
                tags={itemTagsById[item.id] ?? []}
                isSelected={selectedId === item.id}
                isChecked={checkedIds.has(item.id)}
                showCheckbox={checkedIds.size > 0}
                onCheck={() => onCheck(item.id)}
                onOpen={() => onOpen(item.id)}
              />
            </div>
          );
        })}
      </div>
      {loadingMore && (
        <div className="py-3 text-center text-xs italic text-muted-foreground">Loading more…</div>
      )}
    </div>
  );
}

function DraggableItemRow({
  item,
  tags,
  isSelected,
  isChecked,
  showCheckbox,
  onCheck,
  onOpen,
}: {
  item: DirectoryListItem;
  tags: string[];
  isSelected: boolean;
  isChecked: boolean;
  showCheckbox: boolean;
  onCheck: () => void;
  onOpen: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: item.id });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "group relative flex items-start gap-2 px-4 py-3 transition-colors",
        isSelected ? "bg-accent" : "hover:bg-accent/50",
        isDragging && "opacity-40",
      )}
    >
      {isSelected && (
        <span className="absolute inset-y-3 left-0 w-[2px] rounded-full bg-brand" />
      )}
      <button
        {...attributes}
        {...listeners}
        aria-label="Drag to move"
        className="mt-1 cursor-grab text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100 active:cursor-grabbing"
        onClick={(e) => e.preventDefault()}
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>

      <div
        className={cn(
          "mt-1 transition-opacity",
          isChecked || showCheckbox ? "opacity-100" : "opacity-0 group-hover:opacity-100",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <Checkbox
          checked={isChecked}
          onCheckedChange={onCheck}
          aria-label={`Select ${item.title}`}
        />
      </div>

      <button onClick={onOpen} className="min-w-0 flex-1 text-left">
        <div className="mb-1.5 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
          {KIND_META[item.kind].icon}
          <span>{KIND_META[item.kind].label}</span>
          <span className="opacity-50">·</span>
          <span className="normal-case" style={{ letterSpacing: 0 }}>{formatRelativeTime(item.updatedAt)}</span>
        </div>
        <div
          className="text-[0.95rem] font-medium leading-snug tracking-[-0.008em]"
          style={{ fontFamily: "var(--app-font-display)" }}
        >
          {item.title}
        </div>
        {item.preview && (
          <div className="mt-1 line-clamp-2 text-[0.78rem] leading-relaxed text-muted-foreground">
            {item.preview}
          </div>
        )}
        {tags.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {tags.slice(0, 5).map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center rounded-full bg-muted px-1.5 py-0 font-mono text-[10px] text-muted-foreground"
              >
                #{tag}
              </span>
            ))}
          </div>
        )}
      </button>
    </div>
  );
}

function UploadButton({ onPick }: { onPick: (files: FileList) => void }) {
  const inputId = "directory-upload";
  return (
    <>
      <input
        id={inputId}
        type="file"
        multiple
        accept=".pdf,.md,.markdown,.txt,.epub,.docx,.pptx"
        className="hidden"
        onChange={(e) => {
          if (e.target.files) onPick(e.target.files);
          e.target.value = "";
        }}
      />
      <Button
        size="icon"
        variant="ghost"
        className="h-7 w-7"
        title="Upload PDF / DOCX / PPTX / Markdown / Text / ePub"
        onClick={() => document.getElementById(inputId)?.click()}
      >
        <Upload className="h-3.5 w-3.5" />
      </Button>
    </>
  );
}

const SORT_LABELS: Record<DirectorySort, string> = {
  updated: "Updated",
  created: "Created",
  title: "Title (A–Z)",
  tags: "Most tagged",
};

/** Sort the Directory list. Persists via ?sort= so it survives reload + paging. */
function SortControls({ active }: { active: DirectorySort }) {
  const router = useRouter();
  const params = useSearchParams();

  function setSort(next: DirectorySort) {
    const sp = new URLSearchParams(params.toString());
    if (next === "updated") sp.delete("sort");
    else sp.set("sort", next);
    sp.delete("item");
    router.push(`/directory?${sp.toString()}`, { scroll: false });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 font-mono text-[11px] uppercase tracking-wide" title="Sort">
          <ArrowDownUp className="h-3.5 w-3.5" />
          {SORT_LABELS[active]}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {(Object.keys(SORT_LABELS) as DirectorySort[]).map((s) => (
          <DropdownMenuItem key={s} onClick={() => setSort(s)} className="flex items-center justify-between">
            {SORT_LABELS[s]}
            {active === s && <Check className="h-3.5 w-3.5" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
