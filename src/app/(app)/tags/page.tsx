import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { itemTags, tags } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { TagManager } from "@/components/tags/tag-manager";
import { ExportMemoryButton } from "@/components/tags/export-memory-button";

export default async function TagsPage() {
  const { user } = await requireUser();

  const [allTags, usage] = await Promise.all([
    db.select().from(tags).where(eq(tags.userId, user.id)).orderBy(asc(tags.name)),
    db
      .select({
        tagId: itemTags.tagId,
        kind: itemTags.itemKind,
        count: sql<number>`count(*)::int`.as("count"),
      })
      .from(itemTags)
      .where(eq(itemTags.userId, user.id))
      .groupBy(itemTags.tagId, itemTags.itemKind),
  ]);

  // Aggregate per-tag totals and per-kind breakdowns
  type Usage = { total: number; article: number; document: number; directoryItem: number };
  const usageById: Record<string, Usage> = {};
  for (const t of allTags) {
    usageById[t.id] = { total: 0, article: 0, document: 0, directoryItem: 0 };
  }
  for (const u of usage) {
    if (!usageById[u.tagId]) continue;
    usageById[u.tagId].total += u.count;
    if (u.kind === "article") usageById[u.tagId].article += u.count;
    if (u.kind === "document") usageById[u.tagId].document += u.count;
    if (u.kind === "directory_item") usageById[u.tagId].directoryItem += u.count;
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-6 py-10">
        <header className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Tags</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {allTags.length === 0
                ? "No tags yet. Upload a document or save an article to your Directory and the AI will start tagging."
                : `${allTags.length} tag${allTags.length === 1 ? "" : "s"}. Rename or delete to keep your taxonomy clean.`}
            </p>
          </div>
          <ExportMemoryButton />
        </header>
        <TagManager tags={allTags} usage={usageById} />
      </div>
    </div>
  );
}
