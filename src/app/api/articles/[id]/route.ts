import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { articles, feeds, folders } from "@/lib/db/schema";
import { getApiUser } from "@/lib/auth";
import { cleanHtml } from "@/lib/sanitize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/articles/:id
 * Returns the article + its feed metadata + the feed's folder name (if any),
 * so the article reader can show a "Feeds > Folder > Feed" breadcrumb.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, error } = await getApiUser();
  if (!user) return NextResponse.json({ error: error?.message }, { status: error?.status });

  const [row] = await db
    .select({
      id: articles.id,
      title: articles.title,
      excerpt: articles.excerpt,
      author: articles.author,
      url: articles.url,
      publishDate: articles.publishDate,
      readStatus: articles.readStatus,
      starred: articles.starred,
      readLater: articles.readLater,
      wordCount: articles.wordCount,
      fullText: articles.fullText,
      feedId: articles.feedId,
      feedTitle: feeds.title,
      feedIconUrl: feeds.iconUrl,
      feedFolderId: feeds.folderId,
      feedFolderName: folders.name,
    })
    .from(articles)
    .innerJoin(feeds, eq(feeds.id, articles.feedId))
    .leftJoin(folders, eq(folders.id, feeds.folderId))
    .where(and(eq(articles.id, id), eq(articles.userId, user.id)))
    .limit(1);

  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // Sanitize the cached HTML before it reaches the client's dangerouslySetInnerHTML.
  return NextResponse.json({ ...row, fullText: row.fullText ? cleanHtml(row.fullText) : null });
}
