import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { directoryItems, itemTags, tags } from "@/lib/db/schema";
import { getApiUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type MapNode = {
  id: string;
  kind: "tag" | "item";
  label: string;
  itemKind?: "saved_article" | "uploaded_document" | "user_note";
  connections: number;
};

export type MapLink = {
  source: string;
  target: string;
};

const HARD_NODE_CAP = 300;

/**
 * GET /api/map — nodes + links for the Obsidian-style graph view.
 *
 * Caps the rendered graph at HARD_NODE_CAP nodes by keeping the most-connected
 * items and tags. The cap prevents the canvas from choking on graphs of
 * thousands of nodes; the legend tells the user when it kicks in.
 */
export async function GET() {
  const { user, error } = await getApiUser();
  if (!user) return NextResponse.json({ error: error?.message }, { status: error?.status });

  const [items, allTags, allLinks] = await Promise.all([
    db
      .select({ id: directoryItems.id, title: directoryItems.title, kind: directoryItems.kind })
      .from(directoryItems)
      .where(eq(directoryItems.userId, user.id)),
    db.select({ id: tags.id, name: tags.name }).from(tags).where(eq(tags.userId, user.id)),
    db
      .select({ tagId: itemTags.tagId, itemId: itemTags.itemId })
      .from(itemTags)
      .where(eq(itemTags.userId, user.id)),
  ]);

  // Count connections per id to rank importance
  const itemConn = new Map<string, number>();
  const tagConn = new Map<string, number>();
  for (const l of allLinks) {
    itemConn.set(l.itemId, (itemConn.get(l.itemId) ?? 0) + 1);
    tagConn.set(l.tagId, (tagConn.get(l.tagId) ?? 0) + 1);
  }

  const referencedItems = items.filter((i) => itemConn.has(i.id));
  const referencedTags = allTags.filter((t) => tagConn.has(t.id));
  const totalReferenced = referencedItems.length + referencedTags.length;
  let truncated = false;

  let displayItems = referencedItems;
  let displayTags = referencedTags;

  if (totalReferenced > HARD_NODE_CAP) {
    truncated = true;
    const itemBudget = Math.floor(HARD_NODE_CAP * 0.7);
    const tagBudget = HARD_NODE_CAP - itemBudget;
    displayItems = [...referencedItems]
      .sort((a, b) => (itemConn.get(b.id) ?? 0) - (itemConn.get(a.id) ?? 0))
      .slice(0, itemBudget);
    displayTags = [...referencedTags]
      .sort((a, b) => (tagConn.get(b.id) ?? 0) - (tagConn.get(a.id) ?? 0))
      .slice(0, tagBudget);
  }

  const visibleItemIds = new Set(displayItems.map((i) => i.id));
  const visibleTagIds = new Set(displayTags.map((t) => t.id));

  const nodes: MapNode[] = [
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

  const links: MapLink[] = allLinks
    .filter((l) => visibleItemIds.has(l.itemId) && visibleTagIds.has(l.tagId))
    .map((l) => ({
      source: `t:${l.tagId}`,
      target: `i:${l.itemId}`,
    }));

  return NextResponse.json({
    nodes,
    links,
    truncated,
    total: totalReferenced,
    shown: nodes.length,
  });
}
