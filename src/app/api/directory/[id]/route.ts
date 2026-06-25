import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { directoryFolders, directoryItems, documents, itemTags, tags } from "@/lib/db/schema";
import { getApiUser } from "@/lib/auth";
import { getOutgoingLinks, getBacklinks } from "@/lib/directory/wikilinks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, error } = await getApiUser();
  if (!user) return NextResponse.json({ error: error?.message }, { status: error?.status });

  const [row] = await db
    .select({
      id: directoryItems.id,
      title: directoryItems.title,
      kind: directoryItems.kind,
      content: directoryItems.content,
      sourceUrl: directoryItems.sourceUrl,
      articleId: directoryItems.articleId,
      documentId: directoryItems.documentId,
      folderId: directoryItems.folderId,
      metadata: directoryItems.metadata,
      createdAt: directoryItems.createdAt,
      updatedAt: directoryItems.updatedAt,
      docKind: documents.kind,
      docFullText: documents.fullText,
    })
    .from(directoryItems)
    .leftJoin(documents, eq(documents.id, directoryItems.documentId))
    .where(and(eq(directoryItems.id, id), eq(directoryItems.userId, user.id)))
    .limit(1);

  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Build a folder breadcrumb by walking up parent_id. Capped at 8 hops to
  // protect against accidental cycles.
  const breadcrumb: { id: string; name: string }[] = [];
  if (row.folderId) {
    const allFolders = await db
      .select({
        id: directoryFolders.id,
        name: directoryFolders.name,
        parentId: directoryFolders.parentId,
      })
      .from(directoryFolders)
      .where(eq(directoryFolders.userId, user.id));
    const byId = new Map(allFolders.map((f) => [f.id, f]));
    let cur = byId.get(row.folderId) ?? null;
    let safety = 0;
    while (cur && safety < 8) {
      breadcrumb.unshift({ id: cur.id, name: cur.name });
      if (!cur.parentId) break;
      cur = byId.get(cur.parentId) ?? null;
      safety += 1;
    }
  }

  // Assigned tag names for the inspector drawer.
  const tagRows = await db
    .select({ name: tags.name })
    .from(itemTags)
    .innerJoin(tags, eq(tags.id, itemTags.tagId))
    .where(
      and(
        eq(itemTags.userId, user.id),
        eq(itemTags.itemKind, "directory_item"),
        eq(itemTags.itemId, id),
      ),
    );

  // Wikilinks: outgoing ([[Title]] in this item's text, resolved) + backlinks.
  const [outgoingLinks, backlinks] = await Promise.all([
    getOutgoingLinks(user.id, row.content),
    getBacklinks(user.id, id),
  ]);

  // Pinned "Essence" (distilled TL;DR + key points), if it exists in metadata.
  const summary =
    (row.metadata as { summary?: { tldr: string; keyPoints: string[]; at: string } } | null)
      ?.summary ?? null;

  const { metadata: _metadata, ...rest } = row;
  return NextResponse.json({
    ...rest,
    summary,
    breadcrumb,
    tags: tagRows.map((t) => t.name),
    outgoingLinks,
    backlinks,
  });
}
