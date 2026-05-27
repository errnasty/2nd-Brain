"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { FileText, Newspaper, NotebookPen, Plus, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn, formatRelativeTime } from "@/lib/utils";
import { createNoteAction, uploadToDirectoryAction } from "@/app/(app)/directory/actions";
import { toast } from "sonner";
import { ItemViewer } from "./item-viewer";

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
  activeFolder,
  activeTagIds,
}: {
  items: DirectoryListItem[];
  activeFolder: string | null;
  activeTagIds: string[];
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

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
            selectedId={selectedId}
            onOpen={selectItem}
          />
        )}
      </section>

      {/* Viewer */}
      <ItemViewer
        item={selectedItem}
        onClose={() => selectItem(null)}
      />
    </>
  );
}

function VirtualizedDirectoryList({
  items,
  selectedId,
  onOpen,
}: {
  items: DirectoryListItem[];
  selectedId: string | null;
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
              <button
                onClick={() => onOpen(item.id)}
                className={cn(
                  "block w-full px-4 py-3 text-left transition-colors",
                  selectedId === item.id ? "bg-accent" : "hover:bg-accent/50",
                )}
              >
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
              </button>
            </div>
          );
        })}
      </div>
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
        accept=".pdf,.md,.markdown,.txt,.epub"
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
        title="Upload PDF / Markdown / Text / ePub"
        onClick={() => document.getElementById(inputId)?.click()}
      >
        <Upload className="h-3.5 w-3.5" />
      </Button>
    </>
  );
}
