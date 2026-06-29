import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { directoryFolders, directoryItems, directoryLinks, itemTags, tags } from "@/lib/db/schema";
import { getApiUser } from "@/lib/auth";
import { getCachedMap, setCachedMap } from "@/lib/map-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type MapNode = {
  id: string;
  kind: "tag" | "item" | "folder";
  label: string;
  itemKind?: "saved_article" | "uploaded_document" | "user_note";
  connections: number;
  addedAt?: string; // item creation time (ISO) — powers the time-range filter
};

export type MapLink = {
  source: string;
  target: string;
  kind: "tag" | "folder" | "link"; // tag membership · folder inheritance · wikilink
};

const HARD_NODE_CAP = 300;

/**
 * GET /api/map — nodes + links for the Obsidian-style graph view.
 *
 * Nodes: folders (largest), tags (medium), items (small).
 * Links:
 *   - folder inheritance: item → its parent folder, folder → parent folder
 *   - tag membership: tag → item
 * Capped at HARD_NODE_CAP most-connected nodes so the canvas stays smooth.
 */
export async function GET(req: Request) {
  const { user, error } = await getApiUser();
  if (!user) return NextResponse.json({ error: error?.message }, { status: error?.status });

  // Local graph: ?center=<itemId> restricts to that item's depth-N neighborhood.
  const sp = new URL(req.url).searchParams;
  const center = sp.get("center");
  const depth = Math.max(1, Math.min(4, parseInt(sp.get("depth") ?? "1", 10) || 1));

  // Serve the cached full graph when available (local graphs are small + skip
  // the cache so they're always fresh).
  if (!center) {
    const cached = getCachedMap(user.id);
    if (cached) return NextResponse.json(cached);
  }

  const [items, allTags, allLinks, folders, wikiLinks] = await Promise.all([
    db
      .select({
        id: directoryItems.id,
        title: directoryItems.title,
        kind: directoryItems.kind,
        folderId: directoryItems.folderId,
        createdAt: directoryItems.createdAt,
      })
      .from(directoryItems)
      .where(eq(directoryItems.userId, user.id)),
    db.select({ id: tags.id, name: tags.name }).from(tags).where(eq(tags.userId, user.id)),
    db
      .select({ tagId: itemTags.tagId, itemId: itemTags.itemId })
      .from(itemTags)
      .where(eq(itemTags.userId, user.id)),
    db
      .select({ id: directoryFolders.id, name: directoryFolders.name, parentId: directoryFolders.parentId })
      .from(directoryFolders)
      .where(eq(directoryFolders.userId, user.id)),
    db
      .select({ source: directoryLinks.sourceItemId, target: directoryLinks.targetItemId })
      .from(directoryLinks)
      .where(eq(directoryLinks.userId, user.id)),
  ]);

  // Connection counts for ranking.
  const itemConn = new Map<string, number>();
  const tagConn = new Map<string, number>();
  const folderConn = new Map<string, number>();
  for (const l of allLinks) {
    itemConn.set(l.itemId, (itemConn.get(l.itemId) ?? 0) + 1);
    tagConn.set(l.tagId, (tagConn.get(l.tagId) ?? 0) + 1);
  }
  for (const it of items) {
    if (it.folderId) {
      itemConn.set(it.id, (itemConn.get(it.id) ?? 0) + 1);
      folderConn.set(it.folderId, (folderConn.get(it.folderId) ?? 0) + 1);
    }
  }
  for (const f of folders) {
    if (f.parentId) folderConn.set(f.parentId, (folderConn.get(f.parentId) ?? 0) + 1);
  }
  for (const w of wikiLinks) {
    itemConn.set(w.source, (itemConn.get(w.source) ?? 0) + 1);
    itemConn.set(w.target, (itemConn.get(w.target) ?? 0) + 1);
  }

  // Item is shown if it has any connection (tag, folder, or wikilink).
  let referencedItems = items.filter((i) => itemConn.has(i.id));
  let referencedTags = allTags.filter((t) => tagConn.has(t.id));
  // Show all folders that contain something or nest something.
  let referencedFolders = folders.filter((f) => folderConn.has(f.id) || folders.some((c) => c.parentId === f.id));

  // ── Local graph: BFS the center item's depth-N neighborhood ──────────
  // Walk a unified adjacency (item↔folder, folder↔parent, tag↔item, wikilinks)
  // out to `depth` hops so 1/2/3 expand the graph like Obsidian's local view.
  let isLocal = false;
  if (center && items.some((i) => i.id === center)) {
    isLocal = true;
    const adj = new Map<string, Set<string>>();
    const link = (a: string, b: string) => {
      (adj.get(a) ?? adj.set(a, new Set()).get(a)!).add(b);
      (adj.get(b) ?? adj.set(b, new Set()).get(b)!).add(a);
    };
    for (const it of items) if (it.folderId) link(`i:${it.id}`, `f:${it.folderId}`);
    for (const f of folders) if (f.parentId) link(`f:${f.id}`, `f:${f.parentId}`);
    for (const l of allLinks) link(`t:${l.tagId}`, `i:${l.itemId}`);
    for (const w of wikiLinks) link(`i:${w.source}`, `i:${w.target}`);

    const reached = new Set<string>([`i:${center}`]);
    let frontier = [`i:${center}`];
    for (let d = 0; d < depth; d++) {
      const next: string[] = [];
      for (const node of frontier) {
        for (const nb of adj.get(node) ?? []) {
          if (!reached.has(nb)) { reached.add(nb); next.push(nb); }
        }
      }
      frontier = next;
      if (frontier.length === 0) break;
    }

    referencedItems = items.filter((i) => reached.has(`i:${i.id}`));
    referencedTags = allTags.filter((t) => reached.has(`t:${t.id}`));
    referencedFolders = folders.filter((f) => reached.has(`f:${f.id}`));
  }

  const totalReferenced = referencedItems.length + referencedTags.length + referencedFolders.length;
  let truncated = false;

  let displayItems = referencedItems;
  let displayTags = referencedTags;
  const displayFolders = referencedFolders; // folders are few; always keep

  if (!isLocal && totalReferenced > HARD_NODE_CAP) {
    truncated = true;
    const budget = HARD_NODE_CAP - displayFolders.length;
    const itemBudget = Math.max(0, Math.floor(budget * 0.7));
    const tagBudget = Math.max(0, budget - itemBudget);
    displayItems = [...referencedItems]
      .sort((a, b) => (itemConn.get(b.id) ?? 0) - (itemConn.get(a.id) ?? 0))
      .slice(0, itemBudget);
    displayTags = [...referencedTags]
      .sort((a, b) => (tagConn.get(b.id) ?? 0) - (tagConn.get(a.id) ?? 0))
      .slice(0, tagBudget);
  }

  const visibleItemIds = new Set(displayItems.map((i) => i.id));
  const visibleTagIds = new Set(displayTags.map((t) => t.id));
  const visibleFolderIds = new Set(displayFolders.map((f) => f.id));

  const nodes: MapNode[] = [
    ...displayFolders.map<MapNode>((f) => ({
      id: `f:${f.id}`,
      kind: "folder",
      label: f.name,
      connections: folderConn.get(f.id) ?? 0,
    })),
    ...displayItems.map<MapNode>((i) => ({
      id: `i:${i.id}`,
      kind: "item",
      label: i.title,
      itemKind: i.kind,
      connections: itemConn.get(i.id) ?? 0,
      addedAt: i.createdAt ? new Date(i.createdAt).toISOString() : undefined,
    })),
    ...displayTags.map<MapNode>((t) => ({
      id: `t:${t.id}`,
      kind: "tag",
      label: t.name,
      connections: tagConn.get(t.id) ?? 0,
    })),
  ];

  const links: MapLink[] = [];
  // Tag membership
  for (const l of allLinks) {
    if (visibleItemIds.has(l.itemId) && visibleTagIds.has(l.tagId)) {
      links.push({ source: `t:${l.tagId}`, target: `i:${l.itemId}`, kind: "tag" });
    }
  }
  // Folder inheritance: item → folder
  for (const it of displayItems) {
    if (it.folderId && visibleFolderIds.has(it.folderId)) {
      links.push({ source: `f:${it.folderId}`, target: `i:${it.id}`, kind: "folder" });
    }
  }
  // Folder nesting: child folder → parent folder
  for (const f of displayFolders) {
    if (f.parentId && visibleFolderIds.has(f.parentId)) {
      links.push({ source: `f:${f.parentId}`, target: `f:${f.id}`, kind: "folder" });
    }
  }
  // Wikilinks: item → item (solid edges)
  for (const w of wikiLinks) {
    if (visibleItemIds.has(w.source) && visibleItemIds.has(w.target)) {
      links.push({ source: `i:${w.source}`, target: `i:${w.target}`, kind: "link" });
    }
  }

  const payload = {
    nodes,
    links,
    truncated,
    total: totalReferenced,
    shown: nodes.length,
    center: isLocal ? center : null,
  };
  if (!isLocal) setCachedMap(user.id, payload);
  return NextResponse.json(payload);
}
