"use server";

import { and, desc, eq, ilike, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { articles, directoryItems } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";

export type GlobalSearchHit = {
  id: string;
  title: string;
  kind: "article" | "saved_article" | "uploaded_document" | "user_note";
  snippet: string | null;
  href: string;
};

/**
 * Cross-surface search for the ⌘K palette: matches saved RSS articles AND
 * Directory items (docs + notes) by title/body in one round trip. Capped small
 * — the palette is for jumping, not browsing.
 */
export async function globalSearchAction(query: string): Promise<GlobalSearchHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const { user } = await requireUser();
  const pattern = `%${q.replace(/[%_]/g, "\\$&")}%`;

  const [arts, items] = await Promise.all([
    db
      .select({ id: articles.id, title: articles.title, excerpt: articles.excerpt })
      .from(articles)
      .where(
        and(
          eq(articles.userId, user.id),
          or(ilike(articles.title, pattern), ilike(articles.excerpt, pattern)),
        ),
      )
      .orderBy(desc(articles.publishDate))
      .limit(6),
    db
      .select({
        id: directoryItems.id,
        title: directoryItems.title,
        kind: directoryItems.kind,
        content: directoryItems.content,
      })
      .from(directoryItems)
      .where(
        and(
          eq(directoryItems.userId, user.id),
          or(ilike(directoryItems.title, pattern), ilike(directoryItems.content, pattern)),
        ),
      )
      .orderBy(desc(directoryItems.updatedAt))
      .limit(6),
  ]);

  const itemHits: GlobalSearchHit[] = items.map((i) => ({
    id: i.id,
    title: i.title,
    kind: i.kind,
    snippet: i.content ? i.content.slice(0, 120) : null,
    href: `/directory?item=${i.id}`,
  }));
  const artHits: GlobalSearchHit[] = arts.map((a) => ({
    id: a.id,
    title: a.title,
    kind: "article",
    snippet: a.excerpt,
    href: `/feeds?article=${a.id}`,
  }));

  // Directory items (your curated knowledge) before raw feed articles.
  return [...itemHits, ...artHits];
}
