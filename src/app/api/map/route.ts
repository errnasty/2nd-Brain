import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { directoryFolders, directoryItems, itemTags, tags } from "@/lib/db/schema";
import { getApiUser } from "@/lib/auth";

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
  kind: "tag" | "folder"; // folder-inheritance vs tag membership
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
export async function GET() {
  const { user, error } = await getApiUser();
  if (!user) return NextResponse.json({ error: error?.message }, { status: error?.status });

  const [items, allTags, allLinks, folders] = await Promise.all([
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

  // Item is shown if it has any connection (tag or folder).
  const referencedItems = items.filter((i) => itemConn.has(i.id));
  const referencedTags = allTags.filter((t) => tagConn.has(t.id));
  // Show all folders that contain something or nest something.
  const referencedFolders = folders.filter((f) => folderConn.has(f.id) || folders.some((c) => c.parentId === f.id));

  const totalReferenced = referencedItems.length + referencedTags.length + referencedFolders.length;
  let truncated = false;

  let displayItems = referencedItems;
  let displayTags = referencedTags;
  const displayFolders = referencedFolders; // folders are few; always keep

  if (totalReferenced > HARD_NODE_CAP) {
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

  return NextResponse.json({
    nodes,
    links,
    truncated,
    total: totalReferenced,
    shown: nodes.length,
  });
}
