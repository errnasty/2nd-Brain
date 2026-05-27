"use client";

import { useState, useTransition, type ReactNode } from "react";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  bulkMoveDirectoryItemsAction,
  moveDirectoryFolderToParentAction,
} from "@/app/(app)/directory/actions";

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

  // 4px activation distance so a click that opens an item isn't treated as a drag.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function handleDragEnd(event: DragEndEvent) {
    setActiveItemId(null);
    const activeId = String(event.active.id);
    const targetId = event.over?.id;
    if (!targetId) return;
    const target = String(targetId);
    if (!target.startsWith("folder:")) return;

    // Two kinds of drag sources:
    //   "folder-drag:<id>" — a folder is being dragged (to nest under another)
    //   "<itemUUID>"       — an item is being dragged (to move into a folder)
    const isFolderDrag = activeId.startsWith("folder-drag:");
    const folderTargetId: string | null =
      target === "folder:unsorted" ? null : target.slice("folder:".length);

    if (isFolderDrag) {
      const folderId = activeId.slice("folder-drag:".length);
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

    // Item drag onto a folder (or Unsorted)
    startTransition(async () => {
      const r = await bulkMoveDirectoryItemsAction([activeId], folderTargetId);
      if (r.ok) {
        toast.success(folderTargetId ? "Moved" : "Moved to Unsorted");
        router.refresh();
      }
    });
  }

  return (
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
    </DndContext>
  );
}
