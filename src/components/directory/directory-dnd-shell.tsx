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
import { bulkMoveDirectoryItemsAction } from "@/app/(app)/directory/actions";

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
    const itemId = String(event.active.id);
    const targetId = event.over?.id;
    if (!targetId) return;

    // Drop targets register their id as `folder:<uuid>` or `folder:unsorted`.
    const target = String(targetId);
    if (!target.startsWith("folder:")) return;
    const folderId: string | null = target === "folder:unsorted" ? null : target.slice("folder:".length);

    startTransition(async () => {
      const r = await bulkMoveDirectoryItemsAction([itemId], folderId);
      if (r.ok) {
        toast.success(folderId ? "Moved" : "Moved to Unsorted");
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
