import { and, asc, eq, inArray } from "drizzle-orm";
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
export const maxDuration = 60;

const MAX_BODY_CHARS = 4000; // cap per-item body so the export stays portable

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clip(s: string | null | undefined, n = MAX_BODY_CHARS): string {
  const t = (s ?? "").trim();
  return t.length > n ? t.slice(0, n) + "\n\n…(truncated)" : t;
}

/**
 * GET /api/export/memory
 *
 * Compiles the user's entire knowledge base into a single structured Markdown
 * file (second_brain_memory.md) suitable for uploading to an external LLM
 * sandbox (Claude.ai Project, custom GPT, etc). Folders, items, bodies, and
 * tag associations are rendered with clean headings so the structure is
 * obvious to a reader model.
 */
export async function GET() {
  const { user, error } = await getApiUser();
  if (!user) return new Response(error?.message ?? "Unauthorized", { status: error?.status ?? 401 });

  const [folders, items, allTags, tagLinks] = await Promise.all([
    db.select().from(directoryFolders).where(eq(directoryFolders.userId, user.id)).orderBy(asc(directoryFolders.name)),
    db.select().from(directoryItems).where(eq(directoryItems.userId, user.id)).orderBy(asc(directoryItems.title)),
    db.select().from(tags).where(eq(tags.userId, user.id)).orderBy(asc(tags.name)),
    db
      .select({ itemId: itemTags.itemId, tagId: itemTags.tagId })
      .from(itemTags)
      .where(and(eq(itemTags.userId, user.id), eq(itemTags.itemKind, "directory_item"))),
  ]);

  // Resolve bodies for each item: notes use content directly; articles/docs
  // pull from their source tables.
  const articleIds = items.filter((i) => i.articleId).map((i) => i.articleId!) as string[];
  const documentIds = items.filter((i) => i.documentId).map((i) => i.documentId!) as string[];

  const [articleRows, documentRows] = await Promise.all([
    articleIds.length
      ? db
          .select({ id: articles.id, fullText: articles.fullText, excerpt: articles.excerpt, url: articles.url })
          .from(articles)
          .where(inArray(articles.id, articleIds))
      : Promise.resolve([] as { id: string; fullText: string | null; excerpt: string | null; url: string }[]),
    documentIds.length
      ? db
          .select({ id: documents.id, fullText: documents.fullText })
          .from(documents)
          .where(inArray(documents.id, documentIds))
      : Promise.resolve([] as { id: string; fullText: string | null }[]),
  ]);

  const articleById = new Map(articleRows.map((a) => [a.id, a]));
  const documentById = new Map(documentRows.map((d) => [d.id, d]));
  const tagNameById = new Map(allTags.map((t) => [t.id, t.name]));

  // item id -> [tag names]
  const tagsByItem = new Map<string, string[]>();
  for (const link of tagLinks) {
    const name = tagNameById.get(link.tagId);
    if (!name) continue;
    (tagsByItem.get(link.itemId) ?? tagsByItem.set(link.itemId, []).get(link.itemId)!).push(name);
  }

  // Build folder path (walk parents)
  function folderPath(folderId: string | null): string {
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
  }

  // ── Compose Markdown ──────────────────────────────────────────────
  const now = new Date().toISOString();
  const lines: string[] = [];
  lines.push(`# Second Brain — Memory Export`);
  lines.push(``);
  lines.push(`> Generated ${now} for ${user.email ?? "user"}.`);
  lines.push(`> ${items.length} items · ${folders.length} folders · ${allTags.length} tags.`);
  lines.push(`> This file is a structured snapshot of a personal knowledge base. Each item lists`);
  lines.push(`> its folder path and tags so you can reason about how the knowledge is organized.`);
  lines.push(``);

  // Tag index
  if (allTags.length > 0) {
    lines.push(`## Tag Index`);
    lines.push(``);
    for (const t of allTags) {
      const count = tagLinks.filter((l) => l.tagId === t.id).length;
      lines.push(`- **#${t.name}** — ${count} item(s)`);
    }
    lines.push(``);
  }

  // Group items by folder path
  const kindLabel = (k: string) =>
    k === "user_note" ? "Note" : k === "saved_article" ? "Saved Article" : "Document";

  const itemsByPath = new Map<string, typeof items>();
  for (const it of items) {
    const path = folderPath(it.folderId);
    (itemsByPath.get(path) ?? itemsByPath.set(path, []).get(path)!).push(it);
  }

  lines.push(`## Knowledge Base`);
  lines.push(``);

  for (const [path, group] of Array.from(itemsByPath.entries()).sort()) {
    lines.push(`### 📁 ${path}`);
    lines.push(``);
    for (const it of group) {
      let body = "";
      if (it.kind === "user_note") {
        body = clip(it.content);
      } else if (it.kind === "saved_article" && it.articleId) {
        const a = articleById.get(it.articleId);
        body = clip(a?.fullText ? stripHtml(a.fullText) : a?.excerpt ?? it.content);
      } else if (it.kind === "uploaded_document" && it.documentId) {
        const d = documentById.get(it.documentId);
        body = clip(d?.fullText ?? it.content);
      } else {
        body = clip(it.content);
      }

      const itemTagNames = tagsByItem.get(it.id) ?? [];
      lines.push(`#### ${kindLabel(it.kind)}: ${it.title}`);
      const meta: string[] = [];
      if (it.sourceUrl) meta.push(`Source: ${it.sourceUrl}`);
      if (itemTagNames.length) meta.push(`Tags: ${itemTagNames.map((t) => `#${t}`).join(", ")}`);
      meta.push(`Folder: ${path}`);
      lines.push(`*${meta.join(" · ")}*`);
      lines.push(``);
      lines.push(body || "_(no content)_");
      lines.push(``);
    }
  }

  const markdown = lines.join("\n");

  return new Response(markdown, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": `attachment; filename="second_brain_memory.md"`,
    },
  });
}
