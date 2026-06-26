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

  const totalLinks = allTags.reduce((s, t) => s + (usageById[t.id]?.total ?? 0), 0);
  const topTag = [...allTags].sort(
    (a, b) => (usageById[b.id]?.total ?? 0) - (usageById[a.id]?.total ?? 0),
  )[0];

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-6 py-10">
        {/* ── Editorial masthead ──────────────────────────────────── */}
        <header className="editorial-rule mb-8 pb-4">
          <div className="mb-2.5 flex items-baseline justify-between gap-3 editorial-eyebrow">
            <span>Taxonomy · Vol. III</span>
            <span style={{ color: "hsl(var(--brand))" }}>
              {allTags.length} {allTags.length === 1 ? "tag" : "tags"} · {totalLinks.toLocaleString()} links
            </span>
          </div>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h1
                className="editorial-display m-0"
                style={{ fontSize: "clamp(1.875rem, 3.6vw, 2.625rem)" }}
              >
                Tags
              </h1>
              <p className="mt-3 max-w-[60ch] text-[15px] italic leading-snug text-muted-foreground">
                {allTags.length === 0
                  ? "No tags yet. Upload a document or save an article to your Directory and the AI will start tagging."
                  : topTag
                    ? `${allTags.length} tag${allTags.length === 1 ? "" : "s"} in your taxonomy. Most-used: #${topTag.name} (${usageById[topTag.id]?.total ?? 0} items). Rename or merge to keep the vocabulary tight.`
                    : `${allTags.length} tag${allTags.length === 1 ? "" : "s"}. Rename or delete to keep your taxonomy clean.`}
              </p>
            </div>
            <ExportMemoryButton />
          </div>
        </header>

        <TagManager tags={allTags} usage={usageById} />
      </div>
    </div>
  );
}
