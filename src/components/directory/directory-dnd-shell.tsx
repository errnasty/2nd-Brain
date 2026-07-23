"use client";

import { useCallback, useState, useTransition, type ReactNode } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { GripVertical } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  bulkMoveDirectoryItemsAction,
  moveDirectoryFolderToParentAction,
  updateReadingStatusAction,
} from "@/app/(app)/directory/actions";
import { BoardOptimisticContext } from "./board-optimistic";

type ReadingStatus = "inbox" | "reading" | "done" | "review";
const READING_STATUSES: ReadingStatus[] = ["inbox", "reading", "done", "review"];

/**
 * Owns the DnD context for the entire Directory route so an item dragged out
 * of the list can be dropped onto a folder over in the sidebar. Drop targets
 * are registered by DirectoryNav (folders + Unsorted); drag sources are
 * registered by the virtualized item rows in DirectoryShell.
 */
export function DirectoryDndShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  // Optimistic Kanban: itemId → the column it was just dropped into (pending the
  // server confirm). DirectoryBoard reads this to move the card immediately.
  const [statusOverrides, setStatusOverrides] = useState<Record<string, ReadingStatus>>({});
  const revertStatus = useCallback((id: string) => {
    setStatusOverrides((o) => {
      if (!(id in o)) return o;
      const next = { ...o };
      delete next[id];
      return next;
    });
  }, []);

  // 4px activation distance so a click that opens an item isn't treated as a drag.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function handleDragEnd(event: DragEndEvent) {
    setActiveItemId(null);
    const activeId = String(event.active.id);
    const targetId = event.over?.id;
    if (!targetId) return;
    const target = String(targetId);

    // Kanban: dropping an item card onto a reading-pipeline column.
    if (target.startsWith("status:")) {
      const status = target.slice("status:".length) as ReadingStatus;
      if (!READING_STATUSES.includes(status)) return;
      // Optimistic move: the card jumps to the target column now. The board
      // clears the override once refreshed data confirms it; on error we revert.
      setStatusOverrides((o) => ({ ...o, [activeId]: status }));
      startTransition(async () => {
        const r = await updateReadingStatusAction({ id: activeId, status });
        if (r.ok) {
          router.refresh();
        } else {
          revertStatus(activeId);
          toast.error(r.error);
        }
      });
      return;
    }

    // Drop targets come in two flavors that both mean "move into this
    // folder": the sidebar tree's "folder:<id>" and the content-pane tile's
    // "folder-tile:<id>" (kept distinct from the sidebar's id so dnd-kit
    // doesn't collide the two when the same folder is visible in both places
    // at once — see the ChildFolderTile comment in directory-shell.tsx).
    const isTileTarget = target.startsWith("folder-tile:");
    if (!target.startsWith("folder:") && !isTileTarget) return;
    const targetPrefix = isTileTarget ? "folder-tile:" : "folder:";

    // Drag sources, similarly doubled up:
    //   "folder-drag:<id>" / "folder-tile-drag:<id>" — a folder is being
    //     dragged (to nest under another), from the sidebar or a tile.
    //   "<itemUUID>"                                  — an item drag.
    const isFolderDrag = activeId.startsWith("folder-drag:") || activeId.startsWith("folder-tile-drag:");
    const folderTargetId: string | null =
      target === `${targetPrefix}unsorted` ? null : target.slice(targetPrefix.length);

    if (isFolderDrag) {
      const dragPrefix = activeId.startsWith("folder-tile-drag:") ? "folder-tile-drag:" : "folder-drag:";
      const folderId = activeId.slice(dragPrefix.length);
      if (folderId === folderTargetId) return;
      startTransition(async () => {
        const r = await moveDirectoryFolderToParentAction(folderId, folderTargetId);
        if (r.ok) {
          toast.success(folderTargetId ? "Folder nested" : "Folder moved to root");
          router.refresh();
        } else {
          toast.error(r.error);
        }
      });
      return;
    }

    // Item drag onto a folder (or Unsorted). The action throws (rather than
    // returning ok:false) on a server error, so guard it — otherwise the card
    // just snaps back with no toast and the drop looks eaten.
    startTransition(async () => {
      try {
        const r = await bulkMoveDirectoryItemsAction([activeId], folderTargetId);
        if (r.ok) {
          toast.success(folderTargetId ? "Moved" : "Moved to Unsorted");
          router.refresh();
        } else {
          toast.error("Couldn't move the item.");
        }
      } catch (err) {
        toast.error(`Move failed: ${err instanceof Error ? err.message : "unknown error"}`);
      }
    });
  }

  return (
    <BoardOptimisticContext.Provider value={{ overrides: statusOverrides, revert: revertStatus }}>
    <DndContext
      sensors={sensors}
      onDragStart={(e) => setActiveItemId(String(e.active.id))}
      onDragCancel={() => setActiveItemId(null)}
      onDragEnd={handleDragEnd}
    >
      {/* Children render normally; useDraggable/useDroppable wire themselves up via context */}
      <div className="contents" data-dragging-id={activeItemId ?? undefined}>
        {children}
      </div>
      {/* Floating card under the cursor. Renders independently of the source row,
          so the drag survives the row virtualizing out of a long scrolled list
          (which previously aborted the drag), and gives obvious "I'm moving this"
          feedback instead of the source just going opacity-40 in place. */}
      <DragOverlay dropAnimation={null}>
        {activeItemId &&
        !activeItemId.startsWith("folder-drag:") &&
        !activeItemId.startsWith("folder-tile-drag:") ? (
          <div className="pointer-events-none flex items-center gap-2 rounded-md border border-primary/40 bg-background px-3 py-2 text-sm shadow-lg">
            <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
            Moving item…
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
    </BoardOptimisticContext.Provider>
  );
}
