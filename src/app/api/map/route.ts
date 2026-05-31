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

  // Local graph: ?center=<itemId> restricts the graph to that item's depth-1
  // neighborhood (its folder, tags, wikilink neighbors, and tag-siblings).
  const center = new URL(req.url).searchParams.get("center");

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

  // ── Local graph: restrict to the center item's depth-1 neighborhood ──
  let isLocal = false;
  if (center && items.some((i) => i.id === center)) {
    isLocal = true;
    const centerTags = new Set(allLinks.filter((l) => l.itemId === center).map((l) => l.tagId));
    const centerItem = items.find((i) => i.id === center)!;
    const neighborItems = new Set<string>([center]);
    // wikilink neighbors (both directions)
    for (const w of wikiLinks) {
      if (w.source === center) neighborItems.add(w.target);
      if (w.target === center) neighborItems.add(w.source);
    }
    // tag-siblings (items sharing any of the center's tags)
    for (const l of allLinks) if (centerTags.has(l.tagId)) neighborItems.add(l.itemId);
    const neighborFolders = new Set<string>();
    if (centerItem.folderId) neighborFolders.add(centerItem.folderId);

    referencedItems = items.filter((i) => neighborItems.has(i.id));
    referencedTags = allTags.filter((t) => centerTags.has(t.id));
    referencedFolders = folders.filter((f) => neighborFolders.has(f.id));
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
