"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useDraggable } from "@dnd-kit/core";
import { FileText, GripVertical, Newspaper, NotebookPen, Plus, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { cn, formatRelativeTime } from "@/lib/utils";
import { createNoteAction, uploadToDirectoryAction } from "@/app/(app)/directory/actions";
import { toast } from "sonner";
import { ItemViewer } from "./item-viewer";
import { BulkActionBar } from "./bulk-action-bar";
import type { DirectoryFolder } from "@/lib/db/schema";

export type DirectoryListItem = {
  id: string;
  title: string;
  /** Truncated content for the list view (up to ~240 chars). The full content
   * is fetched on demand via /api/directory/:id when an item is opened. */
  preview: string | null;
  kind: "saved_article" | "uploaded_document" | "user_note";
  folderId: string | null;
  sourceUrl: string | null;
  articleId: string | null;
  documentId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

const KIND_META: Record<DirectoryListItem["kind"], { label: string; icon: React.ReactNode }> = {
  saved_article: { label: "Article", icon: <Newspaper className="h-3.5 w-3.5" /> },
  uploaded_document: { label: "Document", icon: <FileText className="h-3.5 w-3.5" /> },
  user_note: { label: "Note", icon: <NotebookPen className="h-3.5 w-3.5" /> },
};

export function DirectoryShell({
  items,
  itemTagsById,
  folders,
  activeFolder,
  activeTagIds,
}: {
  items: DirectoryListItem[];
  itemTagsById: Record<string, string[]>;
  folders: DirectoryFolder[];
  activeFolder: string | null;
  activeTagIds: string[];
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [, startTransition] = useTransition();

  // Clear bulk selection when the visible items list changes (folder/filter switch)
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

  // Hydrate selection from URL
  useEffect(() => {
    const fromUrl = () => {
      const sp = new URLSearchParams(window.location.search);
      setSelectedId(sp.get("item"));
    };
    fromUrl();
    window.addEventListener("popstate", fromUrl);
    return () => window.removeEventListener("popstate", fromUrl);
  }, []);

  // Clear selection if no longer in the visible list
  useEffect(() => {
    if (!selectedId) return;
    if (!items.some((i) => i.id === selectedId)) {
      setSelectedId(null);
      const url = new URL(window.location.href);
      url.searchParams.delete("item");
      window.history.replaceState(null, "", url.toString());
    }
  }, [items, selectedId]);

  const selectItem = useCallback((id: string | null) => {
    setSelectedId(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("item", id);
    else url.searchParams.delete("item");
    window.history.replaceState(null, "", url.toString());
  }, []);

  function newNote() {
    startTransition(async () => {
      const r = await createNoteAction({
        title: "Untitled note",
        content: "",
        folderId: activeFolder,
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
    Array.from(files).forEach((file) => {
      const fd = new FormData();
      fd.set("file", file);
      if (activeFolder) fd.set("folderId", activeFolder);
      startTransition(async () => {
        const r = await uploadToDirectoryAction(fd);
        if (r.ok) toast.success(`${file.name} uploaded`);
        else toast.error(`${file.name}: ${r.error}`);
      });
    });
  }

  const selectedItem = useMemo(
    () => items.find((i) => i.id === selectedId) ?? null,
    [items, selectedId],
  );

  return (
    <>
      {/* Items list */}
      <section className="hidden w-full max-w-sm shrink-0 flex-col border-r border-border md:flex">
        <div className="flex items-center justify-between px-3 py-3">
          <div className="text-sm font-semibold">
            {activeTagIds.length > 0
              ? `${items.length} tagged`
              : activeFolder
                ? `${items.length} items`
                : "All items"}
          </div>
          <div className="flex items-center gap-0.5">
            <UploadButton onPick={onFilesPicked} />
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={newNote}
              title="New note"
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        <Separator />
        {items.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">
            {activeTagIds.length > 0
              ? "No items match the selected tags."
              : "No items yet. Create a note, upload a PDF, or save articles from your feeds."}
          </div>
        ) : (
          <VirtualizedDirectoryList
            items={items}
            itemTagsById={itemTagsById}
            selectedId={selectedId}
            checkedIds={checkedIds}
            onCheck={toggleChecked}
            onOpen={selectItem}
          />
        )}
      </section>

      {/* Viewer */}
      <ItemViewer
        item={selectedItem}
        onClose={() => selectItem(null)}
      />

      <BulkActionBar
        selectedIds={Array.from(checkedIds)}
        folders={folders}
        onClear={clearSelection}
      />
    </>
  );
}

function VirtualizedDirectoryList({
  items,
  itemTagsById,
  selectedId,
  checkedIds,
  onCheck,
  onOpen,
}: {
  items: DirectoryListItem[];
  itemTagsById: Record<string, string[]>;
  selectedId: string | null;
  checkedIds: Set<string>;
  onCheck: (id: string) => void;
  onOpen: (id: string | null) => void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 96,
    overscan: 6,
    measureElement: (el) => el.getBoundingClientRect().height,
  });

  return (
    <div ref={parentRef} className="flex-1 overflow-y-auto">
      <div
        className="relative w-full divide-y divide-border"
        style={{ height: `${virtualizer.getTotalSize()}px` }}
      >
        {virtualizer.getVirtualItems().map((row) => {
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
    </div>
  );
}

// ── DraggableItemRow ─────────────────────────────────────────────────
// The grip handle on the left is the explicit drag source so the user can
// still click the row body to open the item without accidentally starting a
// drag. The checkbox stops propagation so checking doesn't open the item.

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
        "group flex items-start gap-2 px-4 py-3 transition-colors",
        isSelected ? "bg-accent" : "hover:bg-accent/50",
        isDragging && "opacity-40",
      )}
    >
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
        <div className="mb-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          {KIND_META[item.kind].icon}
          <span>{KIND_META[item.kind].label}</span>
          <span>·</span>
          <span>{formatRelativeTime(item.updatedAt)}</span>
        </div>
        <div className="text-[0.9rem] font-medium leading-snug tracking-[-0.005em]">
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
                className="inline-flex items-center rounded-full bg-muted px-1.5 py-0 text-[10px] text-muted-foreground"
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
