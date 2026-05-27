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
};

export type MapLink = {
  source: string;
  target: string;
};

/** GET /api/map — returns nodes + links for the Obsidian-style graph view. */
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

  // Only emit tag nodes that actually connect to something — keeps the graph clean
  const referencedTagIds = new Set(allLinks.map((l) => l.tagId));
  const referencedItemIds = new Set(allLinks.map((l) => l.itemId));

  const nodes: MapNode[] = [
    ...items
      .filter((i) => referencedItemIds.has(i.id))
      .map<MapNode>((i) => ({
        id: `i:${i.id}`,
        kind: "item",
        label: i.title,
        itemKind: i.kind,
      })),
    ...allTags
      .filter((t) => referencedTagIds.has(t.id))
      .map<MapNode>((t) => ({ id: `t:${t.id}`, kind: "tag", label: t.name })),
  ];

  const links: MapLink[] = allLinks.map((l) => ({
    source: `t:${l.tagId}`,
    target: `i:${l.itemId}`,
  }));

  return NextResponse.json({ nodes, links });
}
