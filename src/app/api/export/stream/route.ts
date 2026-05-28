import { and, asc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  articles,
  directoryFolders,
  directoryItems,
  documents,
  itemTags,
  tags,
} from "@/lib/db/schema";
import { getApiUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const PAGE = 25;
const MAX_BODY_CHARS = 4000;

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clip(s: string | null | undefined): string {
  const t = (s ?? "").trim();
  return t.length > MAX_BODY_CHARS ? t.slice(0, MAX_BODY_CHARS) + "\n\n…(truncated)" : t;
}

/**
 * GET /api/export/stream?folder=<id|unsorted>&tags=<id,id,…>
 *
 * Streams a Markdown export of the (optionally scoped) knowledge base
 * chunk-by-chunk via a ReadableStream. Items are paged from Postgres so the
 * server never holds the whole dataset in memory — footprint stays flat
 * regardless of library size.
 */
export async function GET(req: Request) {
  const { user, error } = await getApiUser();
  if (!user) return new Response(error?.message ?? "Unauthorized", { status: error?.status ?? 401 });

  const url = new URL(req.url);
  const folderParam = url.searchParams.get("folder"); // uuid | "unsorted" | null
  const tagIds = (url.searchParams.get("tags") ?? "").split(",").filter(Boolean);

  // Resolve the set of item ids matching ALL selected tags (if any).
  let tagFilteredIds: string[] | null = null;
  if (tagIds.length > 0) {
    const matched = await db
      .select({ itemId: itemTags.itemId })
      .from(itemTags)
      .where(
        and(
          eq(itemTags.userId, user.id),
          eq(itemTags.itemKind, "directory_item"),
          inArray(itemTags.tagId, tagIds),
        ),
      )
      .groupBy(itemTags.itemId)
      .having(sql`count(distinct ${itemTags.tagId}) = ${tagIds.length}`);
    tagFilteredIds = matched.map((m) => m.itemId);
  }

  const baseConds: SQL[] = [eq(directoryItems.userId, user.id)];
  if (folderParam === "unsorted") baseConds.push(isNull(directoryItems.folderId));
  else if (folderParam) baseConds.push(eq(directoryItems.folderId, folderParam));
  if (tagFilteredIds) {
    if (tagFilteredIds.length === 0) baseConds.push(sql`false`); // no matches
    else baseConds.push(inArray(directoryItems.id, tagFilteredIds));
  }

  // Preload folders + tag links for path/tag rendering (small, structural).
  const [folders, tagRows, allTags] = await Promise.all([
    db
      .select({ id: directoryFolders.id, name: directoryFolders.name, parentId: directoryFolders.parentId })
      .from(directoryFolders)
      .where(eq(directoryFolders.userId, user.id)),
    db
      .select({ itemId: itemTags.itemId, tagId: itemTags.tagId })
      .from(itemTags)
      .where(and(eq(itemTags.userId, user.id), eq(itemTags.itemKind, "directory_item"))),
    db.select({ id: tags.id, name: tags.name }).from(tags).where(eq(tags.userId, user.id)),
  ]);

  const tagNameById = new Map(allTags.map((t) => [t.id, t.name]));
  const tagsByItem = new Map<string, string[]>();
  for (const l of tagRows) {
    const name = tagNameById.get(l.tagId);
    if (name) (tagsByItem.get(l.itemId) ?? tagsByItem.set(l.itemId, []).get(l.itemId)!).push(name);
  }
  const folderPath = (folderId: string | null): string => {
    if (!folderId) return "Unsorted";
    const parts: string[] = [];
    let cur = folders.find((f) => f.id === folderId);
    let safety = 0;
    while (cur && safety < 16) {
      parts.unshift(cur.name);
      cur = cur.parentId ? folders.find((f) => f.id === cur!.parentId) : undefined;
      safety += 1;
    }
    return parts.join(" / ");
  };

  const encoder = new TextEncoder();
  const kindLabel = (k: string) =>
    k === "user_note" ? "Note" : k === "saved_article" ? "Saved Article" : "Document";

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (s: string) => controller.enqueue(encoder.encode(s));
      try {
        const scope =
          folderParam === "unsorted"
            ? "Unsorted items"
            : folderParam
              ? `Folder: ${folderPath(folderParam)}`
              : tagIds.length
                ? `Tags: ${tagIds.map((id) => "#" + (tagNameById.get(id) ?? id)).join(", ")}`
                : "Entire knowledge base";

        send(`# Second Brain — Memory Export\n\n`);
        send(`> Generated ${new Date().toISOString()} · Scope: ${scope}\n\n`);

        let offset = 0;
        let total = 0;
        // Page through items; enqueue each page's markdown, then move on. The
        // only thing retained across iterations is small bookkeeping.
        for (;;) {
          const page = await db
            .select({
              id: directoryItems.id,
              title: directoryItems.title,
              kind: directoryItems.kind,
              content: directoryItems.content,
              sourceUrl: directoryItems.sourceUrl,
              articleId: directoryItems.articleId,
              documentId: directoryItems.documentId,
              folderId: directoryItems.folderId,
            })
            .from(directoryItems)
            .where(and(...baseConds))
            .orderBy(asc(directoryItems.title))
            .limit(PAGE)
            .offset(offset);

          if (page.length === 0) break;

          // Resolve bodies for this page only.
          const aIds = page.filter((p) => p.articleId).map((p) => p.articleId!) as string[];
          const dIds = page.filter((p) => p.documentId).map((p) => p.documentId!) as string[];
          const [aRows, dRows] = await Promise.all([
            aIds.length
              ? db
                  .select({ id: articles.id, fullText: articles.fullText, excerpt: articles.excerpt })
                  .from(articles)
                  .where(inArray(articles.id, aIds))
              : Promise.resolve([] as { id: string; fullText: string | null; excerpt: string | null }[]),
            dIds.length
              ? db
                  .select({ id: documents.id, fullText: documents.fullText })
                  .from(documents)
                  .where(inArray(documents.id, dIds))
              : Promise.resolve([] as { id: string; fullText: string | null }[]),
          ]);
          const aById = new Map(aRows.map((a) => [a.id, a]));
          const dById = new Map(dRows.map((d) => [d.id, d]));

          for (const it of page) {
            let body = "";
            if (it.kind === "saved_article" && it.articleId) {
              const a = aById.get(it.articleId);
              body = clip(a?.fullText ? stripHtml(a.fullText) : a?.excerpt ?? it.content);
            } else if (it.kind === "uploaded_document" && it.documentId) {
              body = clip(dById.get(it.documentId)?.fullText ?? it.content);
            } else {
              body = clip(it.content);
            }
            const itemTagNames = tagsByItem.get(it.id) ?? [];
            const meta = [
              `Folder: ${folderPath(it.folderId)}`,
              itemTagNames.length ? `Tags: ${itemTagNames.map((t) => "#" + t).join(", ")}` : null,
              it.sourceUrl ? `Source: ${it.sourceUrl}` : null,
            ]
              .filter(Boolean)
              .join(" · ");

            send(`## ${kindLabel(it.kind)}: ${it.title}\n`);
            send(`*${meta}*\n\n`);
            send(`${body || "_(no content)_"}\n\n---\n\n`);
            total += 1;
          }

          offset += PAGE;
          if (page.length < PAGE) break;
        }

        if (total === 0) send(`_No items matched this scope._\n`);
        controller.close();
      } catch (err) {
        send(`\n\n> Export error: ${err instanceof Error ? err.message : "unknown"}\n`);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": `attachment; filename="second_brain_export.md"`,
      "cache-control": "no-store",
    },
  });
}
