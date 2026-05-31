import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { directoryItems, directoryLinks } from "@/lib/db/schema";
import { parseWikilinkTitles } from "./wikilinks-parse";

export { parseWikilinkTitles };

/**
 * Re-derive directory_links for one source item from its content. Resolves
 * each [[Title]] to a directory_items id by case-insensitive title match
 * (scoped to the user), then replaces the source's outgoing links. Idempotent.
 */
export async function syncWikilinks(
  userId: string,
  sourceItemId: string,
  content: string | null | undefined,
): Promise<void> {
  try {
    const titles = parseWikilinkTitles(content);

    // Always clear this source's existing links first (handles removals).
    await db
      .delete(directoryLinks)
      .where(and(eq(directoryLinks.userId, userId), eq(directoryLinks.sourceItemId, sourceItemId)));

    if (titles.length === 0) return;

    // Resolve titles → ids (case-insensitive). One query.
    const lowered = titles.map((t) => t.toLowerCase());
    const targets = await db
      .select({ id: directoryItems.id })
      .from(directoryItems)
      .where(
        and(
          eq(directoryItems.userId, userId),
          ne(directoryItems.id, sourceItemId), // no self-links
          inArray(sql`lower(${directoryItems.title})`, lowered),
        ),
      );

    if (targets.length === 0) return;
    await db
      .insert(directoryLinks)
      .values(
        targets.map((t) => ({ sourceItemId, targetItemId: t.id, userId })),
      )
      .onConflictDoNothing();
  } catch (err) {
    // Best-effort: never block a save on link indexing.
    console.warn("syncWikilinks skipped:", err instanceof Error ? err.message : err);
  }
}

export type ResolvedLink = { title: string; id: string | null };

/** Outgoing links for an item: each [[Title]] in its content + resolved id (or null = missing). */
export async function getOutgoingLinks(
  userId: string,
  content: string | null | undefined,
): Promise<ResolvedLink[]> {
  const titles = parseWikilinkTitles(content);
  if (titles.length === 0) return [];
  const rows = await db
    .select({ id: directoryItems.id, title: directoryItems.title })
    .from(directoryItems)
    .where(
      and(
        eq(directoryItems.userId, userId),
        inArray(
          sql`lower(${directoryItems.title})`,
          titles.map((t) => t.toLowerCase()),
        ),
      ),
    );
  const byLower = new Map(rows.map((r) => [r.title.toLowerCase(), r.id]));
  return titles.map((t) => ({ title: t, id: byLower.get(t.toLowerCase()) ?? null }));
}

export type Backlink = { id: string; title: string; kind: string };

/** Items whose content links to `itemId`. */
export async function getBacklinks(userId: string, itemId: string): Promise<Backlink[]> {
  const rows = await db
    .select({ id: directoryItems.id, title: directoryItems.title, kind: directoryItems.kind })
    .from(directoryLinks)
    .innerJoin(directoryItems, eq(directoryItems.id, directoryLinks.sourceItemId))
    .where(and(eq(directoryLinks.userId, userId), eq(directoryLinks.targetItemId, itemId)));
  return rows;
}
