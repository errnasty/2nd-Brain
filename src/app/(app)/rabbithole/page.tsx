import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { directoryItems, documents, rabbitholeNodes } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { getDirectoryItemStudyText } from "@/lib/directory/item-text";
import {
  RabbitholeShell,
  type HoleSummary,
  type RecentItem,
  type RootDoc,
} from "@/components/rabbithole/rabbithole-shell";

export const dynamic = "force-dynamic";

type Search = Promise<{ item?: string }>;

export default async function RabbitholePage({ searchParams }: { searchParams: Search }) {
  const { item } = await searchParams;
  const { user } = await requireUser();

  // All four queries are independent of each other (the recent-items filter
  // and the root assembly only combine results after the fact), so run them
  // in one parallel batch instead of four serial round-trips.
  const [holes, recentRows, selectedRows, resolved] = await Promise.all([
    // Existing holes: one row per Directory item that has branches, newest dig first.
    db
      .select({
        itemId: rabbitholeNodes.itemId,
        title: directoryItems.title,
        branchCount: sql<number>`count(*)::int`,
        lastAt: sql<string>`max(${rabbitholeNodes.createdAt})::text`,
      })
      .from(rabbitholeNodes)
      .innerJoin(directoryItems, eq(directoryItems.id, rabbitholeNodes.itemId))
      .where(eq(rabbitholeNodes.userId, user.id))
      .groupBy(rabbitholeNodes.itemId, directoryItems.title)
      .orderBy(desc(sql`max(${rabbitholeNodes.createdAt})`)) as Promise<HoleSummary[]>,
    // Recently touched Directory items without a hole yet — starting points.
    db
      .select({ id: directoryItems.id, title: directoryItems.title, kind: directoryItems.kind })
      .from(directoryItems)
      .where(eq(directoryItems.userId, user.id))
      .orderBy(desc(directoryItems.updatedAt))
      .limit(30),
    // Selected item row + resolved root text (same resolver the API uses).
    item
      ? db
          .select({ id: directoryItems.id, kind: directoryItems.kind, docKind: documents.kind })
          .from(directoryItems)
          .leftJoin(documents, eq(documents.id, directoryItems.documentId))
          .where(and(eq(directoryItems.id, item), eq(directoryItems.userId, user.id)))
          .limit(1)
      : Promise.resolve([]),
    item ? getDirectoryItemStudyText(user.id, item) : Promise.resolve(null),
  ]);

  const holeIds = new Set(holes.map((h) => h.itemId));
  const recent: RecentItem[] = recentRows.filter((r) => !holeIds.has(r.id)).slice(0, 15);

  let root: RootDoc | null = null;
  const [row] = selectedRows;
  if (row && resolved) {
    root = {
      itemId: row.id,
      title: resolved.title,
      text: resolved.text,
      markdown: row.kind === "user_note" || row.docKind === "markdown",
    };
  }

  return <RabbitholeShell holes={holes} recent={recent} root={root} />;
}
