"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { ArrowDownUp, BookOpen, Brain, Loader2, ChevronLeft, Check, FileText, FolderClosed, FolderPlus, GraduationCap, GripVertical, LayoutGrid, Library, Lightbulb, Link2, List, MoreVertical, Newspaper, NotebookPen, Pencil, Plus, SlidersHorizontal, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { cn, formatRelativeTime } from "@/lib/utils";
import {
  bulkDeleteDirectoryItemsAction,
  bulkMoveDirectoryItemsAction,
  createDirectoryFolderAction,
  createNoteAction,
  fetchDirectoryItemByIdAction,
  loadMoreDirectoryItemsAction,
  renameDirectoryFolderAction,
} from "@/app/(app)/directory/actions";
import { buildFlashcards } from "@/components/study/build-flashcards";
import { buildQuiz, quizReadyMessage } from "@/components/study/build-quiz";
import {
  CONTEXT_MENU_PRIMITIVES,
  DROPDOWN_MENU_PRIMITIVES,
  ItemRowMenuItems,
} from "./item-row-menu";
import { DIRECTORY_PAGE_SIZE } from "@/lib/directory/constants";
import { maxUploadBytesFor, maxUploadLabelFor } from "@/lib/upload-limits";
import { toast } from "sonner";
import { uploadFileWithProgress } from "@/lib/ui/upload-with-progress";
import { usePromptText } from "@/components/ui/app-dialogs";
import { pushRecent } from "@/lib/directory/recently-viewed";
import { replaceUrl } from "@/lib/ui/replace-url";
import { lastResolvedIndex, resolveVirtualRows } from "@/lib/ui/virtual-rows";
import { folderPathTo } from "@/lib/directory/folder-tree";
import { BulkActionBar } from "./bulk-action-bar";
import { FolderBulkActionBar } from "./folder-bulk-action-bar";

// Everything below only appears once the user opens something — an item, the
// board view, or a dialog. Statically imported they rode along in /directory's
// first load for every visit, and the viewer is the heavy one: markdown
// rendering, the rabbithole, doc-query and connections panels. Deferred, the
// list paints on a much smaller bundle; the chunk arrives on first use. Same
// treatment /feeds already gives its article reader.
const ItemViewer = dynamic(() => import("./item-viewer").then((m) => m.ItemViewer), {
  ssr: false,
  // Visible at every width — on mobile the list is already hidden once an item
  // is open, so a desktop-only fallback meant tapping an item showed an empty
  // screen until the chunk arrived. Same fix as /feeds' article reader.
  loading: () => (
    <section className="flex flex-1 items-center justify-center" aria-busy="true">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      <span className="sr-only">Loading item</span>
    </section>
  ),
});
const DirectoryBoard = dynamic(() => import("./directory-board").then((m) => m.DirectoryBoard), {
  ssr: false,
  loading: () => <div className="flex-1" aria-busy="true" />,
});
// Lazy like the board: most visits never switch view, and the shelf pulls in
// its own cover loading on top of the grid.
const DirectoryShelf = dynamic(() => import("./directory-shelf").then((m) => m.DirectoryShelf), {
  ssr: false,
  loading: () => <div className="flex-1" aria-busy="true" />,
});
const GapsDialog = dynamic(() => import("./gaps-dialog").then((m) => m.GapsDialog), { ssr: false });
const CurriculumDialog = dynamic(
  () => import("./curriculum-dialog").then((m) => m.CurriculumDialog),
  { ssr: false },
);
const SaveUrlDialog = dynamic(() => import("./save-url-dialog").then((m) => m.SaveUrlDialog), {
  ssr: false,
});
import { useShortcuts } from "@/components/reader/use-shortcuts";
import { useListCollapse } from "@/components/shell/use-list-collapse";
import { lastLocation } from "@/lib/last-location";
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
  /** An ePub the reader can open. See DirItem for why this is not just kind. */
  isBook?: boolean;
  bookFinished?: boolean;
  /** 0..1. Zero for anything that is not a book, or has not been opened. */
  bookProgress?: number;
  bookAuthor?: string | null;
  /** False only when the ePub is known to carry no cover image. */
  bookHasCover?: boolean;
  readingStatus: ReadingStatus;
  createdAt: Date;
  updatedAt: Date;
};

const KIND_META: Record<DirectoryListItem["kind"], { label: string; icon: React.ReactNode }> = {
  saved_article: { label: "Article", icon: <Newspaper className="h-3 w-3" /> },
  uploaded_document: { label: "Document", icon: <FileText className="h-3 w-3" /> },
  user_note: { label: "Note", icon: <NotebookPen className="h-3 w-3" /> },
};

/**
 * A book's cover, where it has one.
 *
 * Plenty of ePubs ship without one, and a request per coverless book is a cost
 * that grows with the library — so the extracted-or-not flag now rides along
 * with the row and those books draw nothing at all. Books ingested before the
 * flag was recorded still fall back to attempting the image and hiding it on a
 * 404, which is what every book used to do.
 */
function BookCover({
  documentId,
  title,
  hasCover = true,
}: {
  documentId: string;
  title: string;
  hasCover?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  if (!hasCover || failed) return null;
  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={`/api/book/${documentId}/cover`}
      alt=""
      aria-hidden
      loading="lazy"
      decoding="async"
      // Intrinsic size so the row reserves the right box before the image
      // lands, and an explicit 2:3 ratio so a cover that is not exactly that
      // gets cropped rather than squashed.
      width={128}
      height={192}
      onError={() => setFailed(true)}
      title={title}
      className="mt-0.5 aspect-[2/3] w-20 shrink-0 self-start rounded border border-border bg-muted object-cover shadow-md sm:w-16"
    />
  );
}

export function DirectoryShell({
  items,
  itemTagsById,
  hasMore,
  folders,
  folderCounts = {},
  activeFolder,
  activeTagIds,
  activeSort = "updated",
  wipLimits = {},
}: {
  items: DirectoryListItem[];
  itemTagsById: Record<string, string[]>;
  hasMore: boolean;
  folders: DirectoryFolder[];
  /** Direct-child item counts per folder id — badges on the subfolder tiles. */
  folderCounts?: Record<string, number>;
  activeFolder: string | null;
  activeTagIds: string[];
  activeSort?: DirectorySort;
  wipLimits?: Record<string, number>;
}) {
  const router = useRouter();
  const promptText = usePromptText();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // The item just created via "New note" — ItemViewer opens it straight into
  // edit mode with the title selected, so typing replaces "Untitled note"
  // instead of requiring a rename + mode-switch first.
  const [freshItemId, setFreshItemId] = useState<string | null>(null);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  // The view, and whether the reader has said what it should be.
  //
  // A folder of books opens on the shelf, because a list of forty rows of
  // identical-looking titles is the wrong way to find a book and the covers are
  // the whole reason the shelf exists. Anywhere else keeps the list. The
  // decision is re-made when the folder changes — walking from a books folder
  // into a notes folder should not leave you on an empty shelf — but never
  // again once the reader has chosen a view themselves: an automatic default is
  // a guess, and a click is not.
  const [view, setView] = useState<"list" | "board" | "shelf">("list");
  const viewPinned = useRef(false);
  const chooseView = useCallback((next: "list" | "board" | "shelf") => {
    viewPinned.current = true;
    setView(next);
  }, []);
  const [listCollapsed, toggleListCollapsed] = useListCollapse("directory.listCollapsed.v1");
  const [gapsOpen, setGapsOpen] = useState(false);
  const [curriculumOpen, setCurriculumOpen] = useState(false);
  const [saveUrlOpen, setSaveUrlOpen] = useState(false);
  const [, startTransition] = useTransition();

  const [extraItems, setExtraItems] = useState<DirectoryListItem[]>([]);
  const [extraTags, setExtraTags] = useState<Record<string, string[]>>({});
  const [pageHasMore, setPageHasMore] = useState(hasMore);
  const [offset, setOffset] = useState(items.length);
  const [loadingMore, setLoadingMore] = useState(false);

  // Items hidden optimistically by an in-flight "delete with undo" — the delete
  // isn't sent to the server until the undo window closes, so the row can
  // reappear instantly if the user hits Undo.
  const [pendingRemovedIds, setPendingRemovedIds] = useState<Set<string>>(new Set());
  const pendingDeletes = useRef<Map<string, { ids: string[]; timer: number }>>(new Map());
  // If the user navigates away mid-undo-window, commit the pending deletes so
  // they aren't silently dropped (the safe direction: the row was removed on
  // screen, so honour that rather than resurrect it on next load).
  useEffect(
    () => () => {
      pendingDeletes.current.forEach(({ ids, timer }) => {
        clearTimeout(timer);
        void bulkDeleteDirectoryItemsAction(ids);
      });
      pendingDeletes.current.clear();
    },
    [],
  );

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

  /**
   * Open a folder of books on the shelf.
   *
   * Judged on the FIRST page of the folder rather than the whole of it, because
   * that is what is loaded when the folder opens and waiting for the rest to
   * decide how to draw it would defeat the point.
   *
   * The bar is high — four items in five, and at least two books — rather than
   * a simple majority, because the shelf draws ONLY books. A folder of thirty
   * books and twenty notes is not a library; switching it to the shelf would
   * quietly hide twenty things. At four in five, what is hidden is a stray or
   * two, and the reader is one click from the list.
   *
   * Runs on the folder, not on the items — appending a page as the reader
   * scrolls must not change the view under them, and neither must a book
   * finishing its upload.
   */
  const folderSig = `${activeFolder ?? ""}|${activeTagIds.join(",")}`;
  const firstPageBooks = items.filter((i) => i.isBook).length;
  const firstPageCount = items.length;
  useEffect(() => {
    if (viewPinned.current) return;
    const mostlyBooks = firstPageBooks >= 2 && firstPageBooks * 5 >= firstPageCount * 4;
    setView(mostlyBooks ? "shelf" : "list");
    // Deliberately keyed on the folder alone: the counts are read at the moment
    // the folder changes and are not themselves a reason to re-decide.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folderSig]);

  // #13 Client-side filter strip (type + age) over the loaded items.
  const [typeFilter, setTypeFilter] = useState<"all" | DirectoryListItem["kind"]>("all");
  const [ageFilter, setAgeFilter] = useState<"any" | "7d" | "30d" | "90d">("any");
  const filteredItems = useMemo(() => {
    const now = Date.now();
    const DAY = 86_400_000;
    const maxAgeMs =
      ageFilter === "7d" ? 7 * DAY : ageFilter === "30d" ? 30 * DAY : ageFilter === "90d" ? 90 * DAY : Infinity;
    return allItems.filter((i) => {
      if (pendingRemovedIds.has(i.id)) return false;
      if (typeFilter !== "all" && i.kind !== typeFilter) return false;
      if (maxAgeMs !== Infinity && now - new Date(i.createdAt).getTime() > maxAgeMs) return false;
      return true;
    });
  }, [allItems, typeFilter, ageFilter, pendingRemovedIds]);

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
      } catch {
        // The action has no error handling of its own, and React sends a
        // rejection thrown inside an async transition to the global error
        // handler — so without this, a failed page left the list simply
        // refusing to grow, with nothing said and nothing to retry. Stop
        // paging and say so. Stopping is not politeness: the end-of-list
        // sentinel re-fires the moment `loadingMore` clears, so leaving it
        // armed would retry a just-failed server on every frame.
        setPageHasMore(false);
        toast.error("Couldn't load more items. Reload the page to try again.");
      } finally {
        setLoadingMore(false);
      }
    });
  }, [loadingMore, pageHasMore, activeFolder, activeTagIds, activeSort, offset]);

  useEffect(() => {
    if (view === "board" && pageHasMore && !loadingMore) loadMore();
  }, [view, pageHasMore, loadingMore, loadMore]);

  const activeTagsKey = activeTagIds.join(",");
  useEffect(() => {
    setCheckedIds(new Set());
    setCheckedFolderIds(new Set());
  }, [activeFolder, activeTagsKey]);

  const toggleChecked = useCallback((id: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setCheckedIds(new Set()), []);

  // Bulk selection over the child-folder tiles (separate from item selection).
  const [checkedFolderIds, setCheckedFolderIds] = useState<Set<string>>(new Set());
  const toggleFolderChecked = useCallback((id: string) => {
    setCheckedFolderIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const clearFolderSelection = useCallback(() => setCheckedFolderIds(new Set()), []);

  const urlItem = useSearchParams().get("item");
  useEffect(() => {
    setSelectedId(urlItem);
  }, [urlItem]);

  // Resume: on a truly bare visit (no query params at all), restore the last
  // folder + open item so "Directory" lands where you left off. Any explicit
  // destination (folder/tags/item/scope/search adds a param) opts out.
  useEffect(() => {
    if (window.location.search) return;
    const f = lastLocation.getDirectoryFolder();
    const i = lastLocation.getDirectoryItem();
    if (!f && !i) return;
    const params = new URLSearchParams();
    if (f) params.set("folder", f);
    if (i) params.set("item", i);
    router.replace(`/directory?${params.toString()}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist the current folder + open item for the next bare visit.
  useEffect(() => {
    lastLocation.setDirectoryFolder(activeFolder);
  }, [activeFolder]);
  useEffect(() => {
    lastLocation.setDirectoryItem(selectedId);
  }, [selectedId]);

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
          replaceUrl(url.toString());
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [allItems, selectedId, hydratedItem]);

  const selectItem = useCallback(
    (id: string | null) => {
      setSelectedId(id);
      const url = new URL(window.location.href);
      if (id) {
        url.searchParams.set("item", id);
        // Track opens from the main list as "recently viewed" — the sidebar
        // tree (DirectoryNav) re-reads this on its own once the URL's `item`
        // param changes, since it's a sibling component with no shared state.
        const opened = allItems.find((i) => i.id === id) ?? (hydratedItem?.id === id ? hydratedItem : null);
        if (opened) pushRecent({ id, kind: "item", title: opened.title });
      } else {
        url.searchParams.delete("item");
      }
      replaceUrl(url.toString());
    },
    [allItems, hydratedItem],
  );

  // Walk filteredItems (not allItems) — j/k should move through what's
  // actually visible under the current type/age filter, not skip into rows
  // hidden by it.
  const moveSelection = useCallback(
    (delta: number) => {
      if (filteredItems.length === 0) return;
      const idx = filteredItems.findIndex((i) => i.id === selectedId);
      const next = idx < 0 ? 0 : Math.min(filteredItems.length - 1, Math.max(0, idx + delta));
      selectItem(filteredItems[next].id);
    },
    [filteredItems, selectedId, selectItem],
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

  // Delete with a 6s undo window instead of a confirm dialog: hide the rows
  // immediately, defer the actual server delete, and let Undo cancel it.
  const deleteItemsWithUndo = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      setPendingRemovedIds((prev) => new Set([...prev, ...ids]));
      if (selectedId && ids.includes(selectedId)) selectItem(null);
      setCheckedIds((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      });

      const key =
        typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random());
      const clearPending = () => {
        setPendingRemovedIds((prev) => {
          const next = new Set(prev);
          ids.forEach((id) => next.delete(id));
          return next;
        });
      };
      const commit = () => {
        pendingDeletes.current.delete(key);
        void bulkDeleteDirectoryItemsAction(ids).then(() => {
          router.refresh();
          clearPending();
        });
      };
      const undo = () => {
        const p = pendingDeletes.current.get(key);
        if (p) clearTimeout(p.timer);
        pendingDeletes.current.delete(key);
        clearPending();
      };
      const timer = window.setTimeout(commit, 6000);
      pendingDeletes.current.set(key, { ids, timer });
      toast(`Deleted ${ids.length} item${ids.length === 1 ? "" : "s"}`, {
        action: { label: "Undo", onClick: undo },
        duration: 6000,
      });
    },
    [router, selectedId, selectItem],
  );

  // Move is instantly reversible (put them back), so it commits immediately and
  // Undo just moves each item to the folder it came from.
  const moveItemsWithUndo = useCallback(
    (ids: string[], folderId: string | null, folderName: string) => {
      if (ids.length === 0) return;
      const originals = new Map<string, string | null>();
      ids.forEach((id) => {
        const it = allItems.find((i) => i.id === id);
        if (it) originals.set(id, it.folderId);
      });
      setCheckedIds((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      });
      void bulkMoveDirectoryItemsAction(ids, folderId).then(() => router.refresh());
      const undo = () => {
        const byFolder = new Map<string | null, string[]>();
        originals.forEach((f, id) => {
          const arr = byFolder.get(f) ?? [];
          arr.push(id);
          byFolder.set(f, arr);
        });
        Promise.all([...byFolder].map(([f, fids]) => bulkMoveDirectoryItemsAction(fids, f))).then(() =>
          router.refresh(),
        );
      };
      toast(`Moved ${ids.length} item${ids.length === 1 ? "" : "s"} to ${folderName}`, {
        action: { label: "Undo", onClick: undo },
        duration: 6000,
      });
    },
    [allItems, router],
  );

  // Row-level "Make flashcards" / "Make quiz" — run straight from the list
  // without opening the item first.
  const rowMakeCards = useCallback((id: string) => {
    // No loading toast: the generation strip in the app layout reports the
    // work, and two things saying "making flashcards" is one too many.
    buildFlashcards(id)
      .then((r) => {
        if (r.ok) toast.success(`Made ${r.count} flashcard${r.count === 1 ? "" : "s"}`);
        else toast.error(r.error);
      })
      .catch(() => toast.error("Couldn't make flashcards"));
  }, []);

  const rowMakeQuiz = useCallback(
    (id: string) => {
      buildQuiz([id])
        .then((r) => {
          if (r.ok) {
            toast.success(quizReadyMessage(r));
            router.push(`/study?tab=quiz&quiz=${r.id}`);
          } else {
            toast.error(r.error);
          }
        })
        .catch(() => toast.error("Couldn't build quiz"));
    },
    [router],
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
        setFreshItemId(r.itemId);
        selectItem(r.itemId);
      } else {
        toast.error(r.error);
      }
    });
  }

  function onFilesPicked(files: FileList) {
    Array.from(files).forEach((file) => {
      // Per file, not per batch: books are allowed to be larger than anything
      // else, so one shared ceiling would reject a legitimate 30MB ePub.
      if (file.size > maxUploadBytesFor(file.name)) {
        toast.error(
          `${file.name} is ${(file.size / 1024 / 1024).toFixed(1)}MB — over the ${maxUploadLabelFor(file.name)} limit.`,
        );
        return;
      }
      // Posted over HTTP rather than as a Server Action so the browser can
      // report how much has gone out: a book is up to fifty megabytes, and a
      // spinner that sits for a minute is indistinguishable from a stuck one.
      // The bar lives in the app's status strip, so leaving the Directory does
      // not lose sight of it.
      void uploadFileWithProgress(file, targetFolderId).then((r) => {
        if (r.ok) {
          toast.success(`${file.name} uploaded`);
          // The new item is on the server, not in this page's props.
          router.refresh();
        } else {
          toast.error(`${file.name}: ${r.error}`);
        }
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
    ? "Tagged"
    : activeFolder === "unsorted"
      ? "Unsorted"
      : activeFolder
        ? "Folder"
        : "All items";

  // Direct subfolders of the active folder, shown as tiles above the item
  // list so a folder that only contains subfolders (no items of its own)
  // reads as "browse into these" instead of a confusing "Empty shelf".
  const childFolders = useMemo(
    () => (activeFolder && activeFolder !== "unsorted" ? folders.filter((f) => f.parentId === activeFolder) : []),
    [folders, activeFolder],
  );
  const showTileRow = !!activeFolder && activeFolder !== "unsorted";

  async function createChildFolder() {
    if (!activeFolder || activeFolder === "unsorted") return;
    const name = (await promptText({ title: "New folder", placeholder: "Folder name" }))?.trim();
    if (!name) return;
    startTransition(async () => {
      const r = await createDirectoryFolderAction(name, activeFolder);
      if (r.ok) {
        toast.success(`Folder "${name}" created`);
        router.refresh();
      } else {
        toast.error(r.error);
      }
    });
  }

  // Ancestor chain for the current folder (breadcrumb), root-first. The walk
  // is cycle-guarded: a folder that is its own ancestor used to spin this
  // `while` forever, freezing the tab mid-render. See `folder-tree.ts`.
  const folderPath = useMemo(
    () => (activeFolder === "unsorted" ? [] : folderPathTo(folders, activeFolder)),
    [folders, activeFolder],
  );

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
          "w-full flex-col border-r border-border",
          view === "board" ? "flex-1" : "lg:max-w-sm lg:shrink-0",
          selectedId ? "hidden" : "flex",
          // Collapse the list on desktop too (only in list view, only with a
          // doc open) so the viewer fills the width. Otherwise re-show at lg+.
          view === "list" && selectedId && listCollapsed ? "lg:hidden" : "lg:flex",
        )}
      >
        {/* ── Editorial header ───────────────────────────────────── */}
        <header className="border-b border-border px-4 pb-3 pt-2 lg:pt-4">
          <div className="mb-1.5 flex items-center gap-1.5 overflow-x-auto editorial-eyebrow">
            {/* Mobile back */}
            <button
              onClick={() => router.push("/directory")}
              className="-ml-0.5 shrink-0 hover:text-foreground lg:hidden"
              title="Folders"
            >
              <ChevronLeft className="h-3 w-3" />
            </button>
            {folderPath.length > 0 ? (
              <nav className="flex min-w-0 items-center gap-1">
                <button onClick={() => router.push("/directory")} className="shrink-0 hover:text-foreground">
                  Directory
                </button>
                {folderPath.slice(0, -1).map((f) => (
                  <span key={f.id} className="flex shrink-0 items-center gap-1">
                    <span className="opacity-50">/</span>
                    <button
                      onClick={() => router.push(`/directory?folder=${f.id}`)}
                      className="max-w-[10rem] truncate hover:text-foreground"
                    >
                      {f.name}
                    </button>
                  </span>
                ))}
              </nav>
            ) : (
              <span>Directory · {headerMeta}</span>
            )}
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

        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
          <div className="flex items-center gap-2">
            <div className="flex items-center rounded-md border border-border p-0.5">
              <button
                onClick={() => chooseView("list")}
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
                onClick={() => chooseView("shelf")}
                title="Shelf view (books by cover)"
                className={cn(
                  "rounded p-1 transition-colors",
                  view === "shelf"
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Library className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => chooseView("board")}
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
          </div>
          <div className="flex items-center gap-0.5">
            {/* Less-frequent actions collapsed into one menu — keeps the row
                from wrapping into an icon-soup on narrow/mobile widths. */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" variant="ghost" className="h-7 w-7" title="More actions">
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {activeFolder && activeFolder !== "unsorted" && (
                  <DropdownMenuItem onClick={() => router.push(`/study?tab=review&folder=${activeFolder}`)}>
                    <Brain className="mr-2 h-3.5 w-3.5" /> Study this folder
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => setCurriculumOpen(true)}>
                  <GraduationCap className="mr-2 h-3.5 w-3.5" /> Generate curriculum
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setGapsOpen(true)}>
                  <Lightbulb className="mr-2 h-3.5 w-3.5" /> Find knowledge gaps
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSaveUrlOpen(true)}>
                  <Link2 className="mr-2 h-3.5 w-3.5" /> Save a page from a URL
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
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
        {showTileRow && (
          <div className="grid grid-cols-2 gap-2 border-b border-border p-3 sm:grid-cols-3">
            {childFolders.map((f) => (
              <ChildFolderTile
                key={f.id}
                folder={f}
                count={folderCounts[f.id] ?? 0}
                checked={checkedFolderIds.has(f.id)}
                selectionActive={checkedFolderIds.size > 0}
                onOpen={() => router.push(`/directory?folder=${f.id}`)}
                onToggleCheck={() => toggleFolderChecked(f.id)}
              />
            ))}
            <NewFolderTile onCreate={createChildFolder} />
          </div>
        )}
        {allItems.length === 0 ? (
          childFolders.length > 0 ? null : (
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
          )
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
            ) : view === "shelf" ? (
              <DirectoryShelf
                items={filteredItems}
                selectedId={selectedId}
                onOpen={selectItem}
              />
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
                folders={folders}
                onCheck={toggleChecked}
                onOpen={selectItem}
                onMakeCards={rowMakeCards}
                onMakeQuiz={rowMakeQuiz}
                onMove={(id, folderId, name) => moveItemsWithUndo([id], folderId, name)}
                onDelete={(id) => deleteItemsWithUndo([id])}
                onReachEnd={loadMore}
                loadingMore={loadingMore}
                hasMore={pageHasMore}
              />
            )}
          </>
        )}
      </section>

      {/* The viewer's own "nothing selected" placeholder is inlined here so the
          chunk is only fetched once something is actually open. */}
      {selectedItem ? (
        <ItemViewer
          item={selectedItem}
          onClose={() => selectItem(null)}
          onRequestDelete={(id) => deleteItemsWithUndo([id])}
          startInEdit={selectedItem.id === freshItemId}
          onStartInEditConsumed={() => setFreshItemId(null)}
          listCollapsed={listCollapsed}
          onToggleList={toggleListCollapsed}
        />
      ) : (
        <section className="hidden flex-1 items-center justify-center text-sm text-muted-foreground lg:flex">
          Select an item to read or edit
        </section>
      )}

      <BulkActionBar
        selectedIds={Array.from(checkedIds)}
        folders={folders}
        onClear={clearSelection}
        onDelete={deleteItemsWithUndo}
        onMove={moveItemsWithUndo}
      />

      <FolderBulkActionBar
        selectedIds={Array.from(checkedFolderIds)}
        folders={folders}
        folderCounts={folderCounts}
        itemSelectionActive={checkedIds.size > 0}
        onClear={clearFolderSelection}
        onChanged={() => router.refresh()}
      />

      {/* Mounted on first open only — each dialog already does its own work in
          an `open` effect, so mounting at open time changes nothing but when
          the code is downloaded. */}
      {gapsOpen && (
        <GapsDialog
          open={gapsOpen}
          onOpenChange={setGapsOpen}
          folder={activeFolder}
          tagIds={activeTagIds}
        />
      )}

      {curriculumOpen && (
        <CurriculumDialog
          open={curriculumOpen}
          onOpenChange={setCurriculumOpen}
          folder={activeFolder}
        />
      )}

      {saveUrlOpen && (
        <SaveUrlDialog open={saveUrlOpen} onOpenChange={setSaveUrlOpen} folder={activeFolder} />
      )}
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
  folders,
  onCheck,
  onOpen,
  onMakeCards,
  onMakeQuiz,
  onMove,
  onDelete,
  onReachEnd,
  loadingMore,
  hasMore,
}: {
  items: DirectoryListItem[];
  itemTagsById: Record<string, string[]>;
  selectedId: string | null;
  checkedIds: Set<string>;
  folders: DirectoryFolder[];
  onCheck: (id: string) => void;
  onOpen: (id: string | null) => void;
  onMakeCards: (id: string) => void;
  onMakeQuiz: (id: string) => void;
  onMove: (id: string, folderId: string | null, folderName: string) => void;
  onDelete: (id: string) => void;
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

  // Rows the virtualizer can't back with an item are dropped rather than
  // dereferenced: deleting (which hides rows for six seconds before the server
  // ever hears about it) and the type/age filters both shrink this list
  // underneath the geometry, and one unbacked row used to take the whole
  // Directory down with it. See `src/lib/ui/virtual-rows.ts`.
  const virtualRows = resolveVirtualRows(virtualizer.getVirtualItems(), items);
  const lastIndex = lastResolvedIndex(virtualRows);
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
        {virtualRows.map(({ row, item }) => {
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
                folders={folders}
                onCheck={() => onCheck(item.id)}
                onOpen={() => onOpen(item.id)}
                onMakeCards={() => onMakeCards(item.id)}
                onMakeQuiz={() => onMakeQuiz(item.id)}
                onMove={(folderId, name) => onMove(item.id, folderId, name)}
                onDelete={() => onDelete(item.id)}
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
  folders,
  onCheck,
  onOpen,
  onMakeCards,
  onMakeQuiz,
  onMove,
  onDelete,
}: {
  item: DirectoryListItem;
  tags: string[];
  isSelected: boolean;
  isChecked: boolean;
  showCheckbox: boolean;
  folders: DirectoryFolder[];
  onCheck: () => void;
  onOpen: () => void;
  onMakeCards: () => void;
  onMakeQuiz: () => void;
  onMove: (folderId: string | null, folderName: string) => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: item.id });

  const menuProps = {
    folders,
    onOpen,
    onMakeCards,
    onMakeQuiz,
    onMove,
    onDelete,
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
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

          {item.isBook && item.documentId && (
            <BookCover
              documentId={item.documentId}
              title={item.title}
              hasCover={item.bookHasCover}
            />
          )}

          <button onClick={onOpen} className="min-w-0 flex-1 text-left">
            <div className="mb-1.5 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
              {item.isBook ? <BookOpen className="h-3 w-3" /> : KIND_META[item.kind].icon}
              <span>{item.isBook ? "Book" : KIND_META[item.kind].label}</span>
              {item.bookFinished && (
                <>
                  <span className="opacity-50">·</span>
                  <span className="inline-flex items-center gap-0.5 text-brand">
                    <Check className="h-3 w-3" /> Read
                  </span>
                </>
              )}
              <span className="opacity-50">·</span>
              <span className="normal-case" style={{ letterSpacing: 0 }}>{formatRelativeTime(item.updatedAt)}</span>
            </div>
            <div
              className="pr-6 text-[0.95rem] font-medium leading-snug tracking-[-0.008em]"
              style={{ fontFamily: "var(--app-font-display)" }}
            >
              {item.title}
            </div>
            {/* A book's preview is its front matter — a table of contents and a
                copyright page. Nothing worth the two lines it costs. */}
            {!item.isBook && item.preview && (
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

          {/* Hover kebab — the same actions as right-click, for people who don't
              think to right-click (and for touch). */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                onClick={(e) => e.stopPropagation()}
                aria-label="Item actions"
                className="absolute right-1.5 top-2.5 rounded p-1 text-muted-foreground opacity-0 backdrop-blur transition-opacity hover:bg-accent hover:text-foreground focus:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
              >
                <MoreVertical className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
              <ItemRowMenuItems prims={DROPDOWN_MENU_PRIMITIVES} {...menuProps} />
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ItemRowMenuItems prims={CONTEXT_MENU_PRIMITIVES} {...menuProps} />
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** A child-folder tile in the content pane: click to browse in, drag the
 *  folder icon to nest it elsewhere (or drop items/other folders onto it),
 *  and a hover/selection checkbox for bulk actions.
 *
 *  Uses its OWN id prefixes (`folder-tile:` / `folder-tile-drag:`), distinct
 *  from the sidebar's FolderRow (`folder:` / `folder-drag:`) — the same
 *  folder is very often visible in both the sidebar tree AND as a tile here
 *  at once, and dnd-kit's draggable/droppable registries are keyed by id, so
 *  reusing the sidebar's id would make one of the two DOM elements silently
 *  stop working as a drop/drag target (whichever registers second wins the
 *  id in dnd-kit's internal map). DirectoryDndShell's handleDragEnd
 *  recognizes both prefixes and resolves them to the same folder id. */
function ChildFolderTile({
  folder,
  count,
  checked,
  selectionActive,
  onOpen,
  onToggleCheck,
}: {
  folder: DirectoryFolder;
  count: number;
  checked: boolean;
  selectionActive: boolean;
  onOpen: () => void;
  onToggleCheck: () => void;
}) {
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: `folder-tile:${folder.id}` });
  const {
    attributes: dragAttrs,
    listeners: dragListeners,
    setNodeRef: setDragRef,
    isDragging,
  } = useDraggable({ id: `folder-tile-drag:${folder.id}` });

  function setNodeRef(node: HTMLDivElement | null) {
    setDropRef(node);
    setDragRef(node);
  }

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "group flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2.5 transition-colors hover:border-brand/40 hover:bg-accent",
        isOver && "ring-2 ring-primary",
        isDragging && "opacity-40",
      )}
    >
      <div
        className={cn(
          "shrink-0 transition-opacity",
          checked || selectionActive ? "opacity-100" : "opacity-0 group-hover:opacity-100",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <Checkbox checked={checked} onCheckedChange={onToggleCheck} aria-label={`Select ${folder.name}`} />
      </div>
      <span
        {...dragAttrs}
        {...dragListeners}
        className="cursor-grab shrink-0 active:cursor-grabbing"
        onClick={(e) => e.preventDefault()}
        aria-label="Drag to nest folder"
      >
        <FolderClosed className="h-4 w-4 text-muted-foreground" />
      </span>
      <button onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-2 text-left">
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{folder.name}</span>
        {count > 0 && (
          <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">{count}</span>
        )}
      </button>
    </div>
  );
}

/** Dashed "+ New folder" tile — creates a subfolder nested directly inside
 *  the folder currently being browsed, no sidebar round-trip needed. */
function NewFolderTile({ onCreate }: { onCreate: () => void }) {
  return (
    <button
      onClick={onCreate}
      className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-border px-3 py-2.5 text-muted-foreground transition-colors hover:border-brand/40 hover:bg-accent hover:text-foreground"
    >
      <FolderPlus className="h-4 w-4 shrink-0" />
      <span className="text-[13px] font-medium">New folder</span>
    </button>
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
