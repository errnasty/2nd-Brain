"use client";

import Dexie, { type Table } from "dexie";

// Local mirror of the sidebar structure. Lets the sidebar paint instantly
// from IndexedDB on cold loads / flaky connections, then reconcile with the
// server in the background.

export type CachedFolder = {
  id: string;
  name: string;
  parentId: string | null;
  position: number;
  isInbox: boolean;
};

export type CachedTag = {
  id: string;
  name: string;
  slug: string;
};

export type SyncMeta = {
  key: string; // "sidebar"
  userId: string;
  syncedAt: number;
};

class SecondBrainDB extends Dexie {
  folders!: Table<CachedFolder, string>;
  tags!: Table<CachedTag, string>;
  meta!: Table<SyncMeta, string>;

  constructor() {
    super("second-brain");
    this.version(1).stores({
      folders: "id, parentId, position",
      tags: "id, slug",
      meta: "key",
    });
  }
}

let _db: SecondBrainDB | null = null;

/** Lazily construct the Dexie instance (browser only). */
export function getOfflineDb(): SecondBrainDB | null {
  if (typeof window === "undefined") return null;
  if (!_db) _db = new SecondBrainDB();
  return _db;
}

type SidebarPayload = {
  userId: string;
  folders: CachedFolder[];
  tags: CachedTag[];
  syncedAt: number;
};

/** Read the mirrored sidebar from IndexedDB (instant, may be empty first run). */
export async function readCachedSidebar(): Promise<{ folders: CachedFolder[]; tags: CachedTag[] } | null> {
  const db = getOfflineDb();
  if (!db) return null;
  try {
    const [folders, tags] = await Promise.all([db.folders.toArray(), db.tags.toArray()]);
    if (folders.length === 0 && tags.length === 0) return null;
    folders.sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
    tags.sort((a, b) => a.name.localeCompare(b.name));
    return { folders, tags };
  } catch {
    return null;
  }
}

/** Replace the mirrored sidebar with a fresh server payload. */
export async function writeCachedSidebar(payload: SidebarPayload): Promise<void> {
  const db = getOfflineDb();
  if (!db) return;
  try {
    await db.transaction("rw", db.folders, db.tags, db.meta, async () => {
      await Promise.all([db.folders.clear(), db.tags.clear()]);
      if (payload.folders.length) await db.folders.bulkPut(payload.folders);
      if (payload.tags.length) await db.tags.bulkPut(payload.tags);
      await db.meta.put({ key: "sidebar", userId: payload.userId, syncedAt: payload.syncedAt });
    });
  } catch {
    // Best-effort cache; ignore quota / private-mode errors.
  }
}

/** Fetch the latest sidebar from the server and update the mirror. */
export async function syncSidebar(): Promise<{ folders: CachedFolder[]; tags: CachedTag[] } | null> {
  try {
    const res = await fetch("/api/sidebar", { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as SidebarPayload;
    await writeCachedSidebar(data);
    return { folders: data.folders, tags: data.tags };
  } catch {
    return null;
  }
}
