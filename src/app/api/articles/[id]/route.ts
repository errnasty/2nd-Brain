import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { articles, feeds } from "@/lib/db/schema";
import { getApiUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/articles/:id
 * Returns the article + its feed metadata.
 *
 * Used by the client-side reader pane so navigating between articles
 * (URL ?article changes) does NOT cause a full server re-render of the
 * article list. Big perf win on slower devices.
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
      fullText: articles.fullText,
      feedTitle: feeds.title,
      feedIconUrl: feeds.iconUrl,
    })
    .from(articles)
    .innerJoin(feeds, eq(feeds.id, articles.feedId))
    .where(and(eq(articles.id, id), eq(articles.userId, user.id)))
    .limit(1);

  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(row);
}
