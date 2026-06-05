import { createHash } from "crypto";
import { asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { directoryFolders, tags } from "@/lib/db/schema";
import { getApiUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/sidebar — the lightweight payload the offline mirror (Dexie) keeps
 * in sync: the Directory folder tree + the tag taxonomy. Titles/ids/structure
 * only; no item bodies.
 *
 * Sends a content ETag (excluding the volatile syncedAt) so the client's
 * `no-cache` revalidation gets a cheap 304 + replays its cached body whenever
 * the tree/tags haven't changed.
 */
export async function GET(req: Request) {
  const { user, error } = await getApiUser();
  if (!user) return NextResponse.json({ error: error?.message }, { status: error?.status });

  const [folders, allTags] = await Promise.all([
    db
      .select({
        id: directoryFolders.id,
        name: directoryFolders.name,
        parentId: directoryFolders.parentId,
        position: directoryFolders.position,
        isInbox: directoryFolders.isInbox,
      })
      .from(directoryFolders)
      .where(eq(directoryFolders.userId, user.id))
      .orderBy(asc(directoryFolders.position), asc(directoryFolders.name)),
    db
      .select({ id: tags.id, name: tags.name, slug: tags.slug })
      .from(tags)
      .where(eq(tags.userId, user.id))
      .orderBy(asc(tags.name)),
  ]);

  const etag = `"${createHash("sha1")
    .update(JSON.stringify({ userId: user.id, folders, tags: allTags }))
    .digest("base64")}"`;

  if (req.headers.get("if-none-match") === etag) {
    return new NextResponse(null, { status: 304, headers: { ETag: etag } });
  }

  return NextResponse.json(
    { userId: user.id, folders, tags: allTags, syncedAt: Date.now() },
    { headers: { ETag: etag, "Cache-Control": "private, no-cache" } },
  );
}
