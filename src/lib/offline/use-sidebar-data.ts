"use client";

import { useEffect, useState } from "react";
import {
  readCachedSidebar,
  syncSidebar,
  type CachedFolder,
  type CachedTag,
} from "./db";

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
