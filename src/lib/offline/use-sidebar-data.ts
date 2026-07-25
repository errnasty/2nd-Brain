"use client";

import { useEffect, useState } from "react";
// Type-only — the module itself carries Dexie (~90 kB), so it's imported
// dynamically inside the effect below and never lands in the caller's chunk.
import type { CachedFolder, CachedTag } from "./db";

export type SidebarData = {
  folders: CachedFolder[];
  tags: CachedTag[];
  /** true until the first paint source (cache or network) resolves */
  loading: boolean;
  /** true while a background server reconcile is in flight */
  syncing: boolean;
};

/**
 * Offline-first sidebar data.
 *  0. Loads the IndexedDB layer (Dexie) on demand, after hydration.
 *  1. Paints instantly from IndexedDB (if present).
 *  2. Kicks off a silent background sync from /api/sidebar, then updates state
 *     + the mirror without blocking the first paint.
 */
export function useSidebarData(): SidebarData {
  const [folders, setFolders] = useState<CachedFolder[]>([]);
  const [tags, setTags] = useState<CachedTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { readCachedSidebar, syncSidebar } = await import("./db");
      if (cancelled) return;
      const cached = await readCachedSidebar();
      if (!cancelled && cached) {
        setFolders(cached.folders);
        setTags(cached.tags);
        setLoading(false);
      }

      setSyncing(true);
      const fresh = await syncSidebar();
      if (!cancelled) {
        if (fresh) {
          setFolders(fresh.folders);
          setTags(fresh.tags);
        }
        setLoading(false);
        setSyncing(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return { folders, tags, loading, syncing };
}
