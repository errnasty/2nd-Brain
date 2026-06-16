"use client";

import { createContext, useContext } from "react";
import type { ReadingStatus } from "@/lib/directory/query";

/**
 * Optimistic Kanban move. The drop is handled in DirectoryDndShell (it owns the
 * route-level DndContext), but the columns are rendered by DirectoryBoard — this
 * context bridges them so a dropped card appears in the target column instantly,
 * instead of waiting ~300-800ms for the server action + router.refresh.
 *
 *  - `overrides[itemId]` = the column the card was just dropped into (pending).
 *  - `revert(id)`        = undo on server error, or clear once the refreshed
 *                          server data already reflects the move.
 */
export type BoardOptimistic = {
  overrides: Record<string, ReadingStatus>;
  revert: (id: string) => void;
};

export const BoardOptimisticContext = createContext<BoardOptimistic>({
  overrides: {},
  revert: () => {},
});

export function useBoardOptimistic(): BoardOptimistic {
  return useContext(BoardOptimisticContext);
}
