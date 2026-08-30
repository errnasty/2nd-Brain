"use server";

import { and, asc, eq, ilike, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  bookChapters,
  bookHighlights,
  bookReadingState,
  directoryItems,
  documentChunks,
  documents,
} from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { embedNote } from "@/lib/embeddings/backfill";
import { syncWikilinks } from "@/lib/directory/wikilinks";
import { revalidatePath } from "next/cache";

/**
 * Marking up a book, searching it, and getting the marks back out.
 *
 * The last part is the point. A highlight that only exists inside a reader is a
 * highlight you will never see again; exported to an ordinary note it becomes
 * searchable, linkable, embeddable and answerable by Ask like everything else
 * in the Directory.
 */

const COLORS = ["yellow", "green", "blue", "pink"] as const;
export type HighlightColor = (typeof COLORS)[number];

export type BookHighlight = {
  id: string;
  chapterIdx: number;
  startOffset: number;
  endOffset: number;
  text: string;
  note: string | null;
  color: HighlightColor;
};

async function assertOwnsBook(documentId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: documents.id })
    .from(documents)
    .where(
      and(eq(documents.id, documentId), eq(documents.userId, userId), eq(documents.kind, "epub")),
    )
    .limit(1);
  return !!row;
}

const CreateSchema = z.object({
  documentId: z.string().uuid(),
  chapterIdx: z.number().int().min(0),
  startOffset: z.number().int().min(0),
  endOffset: z.number().int().min(0),
  // A whole chapter selected by a stray triple-click is not a highlight, and
  // storing it would bloat both the row and the exported note.
  text: z.string().trim().min(1).max(10_000),
  note: z.string().trim().max(4_000).optional(),
  color: z.enum(COLORS).optional(),
});

export async function createHighlightAction(input: {
  documentId: string;
  chapterIdx: number;
  startOffset: number;
  endOffset: number;
  text: string;
  note?: string;
  color?: HighlightColor;
}) {
  const parsed = CreateSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid highlight" };
  if (parsed.data.endOffset <= parsed.data.startOffset) {
    return { ok: false as const, error: "Nothing selected" };
  }

  const { user } = await requireUser();
  if (!(await assertOwnsBook(parsed.data.documentId, user.id))) {
    return { ok: false as const, error: "Not found" };
  }

  const [row] = await db
    .insert(bookHighlights)
    .values({
      userId: user.id,
      documentId: parsed.data.documentId,
      chapterIdx: parsed.data.chapterIdx,
      startOffset: parsed.data.startOffset,
      endOffset: parsed.data.endOffset,
      text: parsed.data.text,
      note: parsed.data.note || null,
      color: parsed.data.color ?? "yellow",
    })
    .returning({ id: bookHighlights.id });

  return { ok: true as const, id: row.id };
}

export async function updateHighlightAction(input: {
  id: string;
  note?: string | null;
  color?: HighlightColor;
}) {
  const parsed = z
    .object({
      id: z.string().uuid(),
      note: z.string().trim().max(4_000).nullable().optional(),
      color: z.enum(COLORS).optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid highlight" };

  const { user } = await requireUser();
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.note !== undefined) set.note = parsed.data.note || null;
  if (parsed.data.color !== undefined) set.color = parsed.data.color;

  await db
    .update(bookHighlights)
    .set(set)
    .where(and(eq(bookHighlights.id, parsed.data.id), eq(bookHighlights.userId, user.id)));

  return { ok: true as const };
}

export async function deleteHighlightAction(id: string) {
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) return { ok: false as const, error: "Invalid highlight" };

  const { user } = await requireUser();
  await db
    .delete(bookHighlights)
    .where(and(eq(bookHighlights.id, parsed.data), eq(bookHighlights.userId, user.id)));

  return { ok: true as const };
}

/* ── Find in book ────────────────────────────────────────────────────── */

export type BookSearchHit = {
  chapterIdx: number;
  chapterTitle: string | null;
  snippet: string;
};

/**
 * Search a book's own text.
 *
 * Runs over the embedding chunks, which already hold every word of the book
 * tagged with the chapter it came from — so this needs no new storage. Chunks
 * overlap, so a phrase can match twice; results are collapsed to one hit per
 * chapter, which is the granularity the reader navigates at anyway. The reader
 * then locates the phrase within that chapter's rendered text to land on the
 * right page.
 */
export async function searchBookAction(input: { documentId: string; query: string }) {
  const parsed = z
    .object({ documentId: z.string().uuid(), query: z.string().trim().min(2).max(200) })
    .safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Type at least two characters" };

  const { user } = await requireUser();
  if (!(await assertOwnsBook(parsed.data.documentId, user.id))) {
    return { ok: false as const, error: "Not found" };
  }

  // Escape LIKE wildcards so searching for "50%" finds "50%".
  const needle = `%${parsed.data.query.replace(/[\\%_]/g, "\\$&")}%`;

  const rows = await db
    .select({
      chapterIdx: documentChunks.chapterIndex,
      content: documentChunks.content,
      chapterTitle: bookChapters.title,
    })
    .from(documentChunks)
    .leftJoin(
      bookChapters,
      and(
        eq(bookChapters.documentId, documentChunks.documentId),
        eq(bookChapters.userId, documentChunks.userId),
        eq(bookChapters.idx, documentChunks.chapterIndex),
      ),
    )
    .where(
      and(
        eq(documentChunks.documentId, parsed.data.documentId),
        eq(documentChunks.userId, user.id),
        ilike(documentChunks.content, needle),
      ),
    )
    .orderBy(asc(documentChunks.chunkIndex))
    .limit(120);

  const seen = new Set<number>();
  const hits: BookSearchHit[] = [];
  const lower = parsed.data.query.toLowerCase();

  for (const row of rows) {
    if (row.chapterIdx === null || seen.has(row.chapterIdx)) continue;
    seen.add(row.chapterIdx);

    const at = row.content.toLowerCase().indexOf(lower);
    const from = Math.max(0, at - 60);
    const snippet =
      (from > 0 ? "…" : "") +
      row.content.slice(from, at + parsed.data.query.length + 90).replace(/\s+/g, " ").trim() +
      "…";

    hits.push({ chapterIdx: row.chapterIdx, chapterTitle: row.chapterTitle, snippet });
    if (hits.length >= 40) break;
  }

  return { ok: true as const, hits };
}

/* ── Getting the marks out ───────────────────────────────────────────── */

/**
 * Write every highlight in a book into a note in the Directory.
 *
 * Updates the same note on a second run rather than leaving a trail of them,
 * and links back to the book with a wikilink so the graph knows where the
 * quotes came from. Re-embedded afterwards, so Ask can answer from your
 * highlights and not just from the book.
 */
export async function exportHighlightsAction(input: { documentId: string; itemId: string }) {
  const parsed = z
    .object({ documentId: z.string().uuid(), itemId: z.string().uuid() })
    .safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid book" };

  const { user } = await requireUser();
  const [doc] = await db
    .select({ title: documents.title })
    .from(documents)
    .where(
      and(
        eq(documents.id, parsed.data.documentId),
        eq(documents.userId, user.id),
        eq(documents.kind, "epub"),
      ),
    )
    .limit(1);
  if (!doc) return { ok: false as const, error: "Not found" };

  const rows = await db
    .select({
      chapterIdx: bookHighlights.chapterIdx,
      startOffset: bookHighlights.startOffset,
      text: bookHighlights.text,
      note: bookHighlights.note,
      chapterTitle: bookChapters.title,
    })
    .from(bookHighlights)
    .leftJoin(
      bookChapters,
      and(
        eq(bookChapters.documentId, bookHighlights.documentId),
        eq(bookChapters.userId, bookHighlights.userId),
        eq(bookChapters.idx, bookHighlights.chapterIdx),
      ),
    )
    .where(
      and(
        eq(bookHighlights.documentId, parsed.data.documentId),
        eq(bookHighlights.userId, user.id),
      ),
    )
    .orderBy(asc(bookHighlights.chapterIdx), asc(bookHighlights.startOffset));

  if (rows.length === 0) return { ok: false as const, error: "Nothing highlighted yet" };

  const lines: string[] = [`Highlights from [[${doc.title}]].`, ""];
  let lastChapter: number | null = null;
  for (const h of rows) {
    if (h.chapterIdx !== lastChapter) {
      lastChapter = h.chapterIdx;
      lines.push(`## ${h.chapterTitle ?? `Chapter ${h.chapterIdx + 1}`}`, "");
    }
    // Blockquoted line by line so a multi-paragraph highlight stays a quote.
    lines.push(...h.text.split("\n").map((l) => `> ${l}`.trimEnd()), "");
    if (h.note) lines.push(h.note, "");
  }

  const content = lines.join("\n").trim();
  const title = `Highlights — ${doc.title}`;

  const [state] = await db
    .select({ noteId: bookReadingState.highlightsNoteId })
    .from(bookReadingState)
    .where(
      and(
        eq(bookReadingState.documentId, parsed.data.documentId),
        eq(bookReadingState.userId, user.id),
      ),
    )
    .limit(1);

  // Confirm the note still exists: it can be deleted from the Directory, and
  // the column only nulls out when that happens through the FK.
  let noteId: string | null = null;
  if (state?.noteId) {
    const [existing] = await db
      .select({ id: directoryItems.id })
      .from(directoryItems)
      .where(and(eq(directoryItems.id, state.noteId), eq(directoryItems.userId, user.id)))
      .limit(1);
    noteId = existing?.id ?? null;
  }

  if (noteId) {
    await db
      .update(directoryItems)
      .set({ title, content, updatedAt: new Date() })
      .where(and(eq(directoryItems.id, noteId), eq(directoryItems.userId, user.id)));
  } else {
    // Filed beside the book, so highlights land in the same folder as the book
    // they came from rather than in the Unsorted pile.
    const [item] = await db
      .select({ folderId: directoryItems.folderId })
      .from(directoryItems)
      .where(and(eq(directoryItems.id, parsed.data.itemId), eq(directoryItems.userId, user.id)))
      .limit(1);

    const [created] = await db
      .insert(directoryItems)
      .values({
        userId: user.id,
        folderId: item?.folderId ?? null,
        kind: "user_note",
        title,
        content,
        updatedAt: new Date(),
      })
      .returning({ id: directoryItems.id });
    noteId = created.id;

    await db
      .insert(bookReadingState)
      .values({ userId: user.id, documentId: parsed.data.documentId, highlightsNoteId: noteId })
      .onConflictDoUpdate({
        target: [bookReadingState.userId, bookReadingState.documentId],
        set: { highlightsNoteId: noteId, updatedAt: new Date() },
      });
  }

  void embedNote(noteId, user.id, title, content);
  void syncWikilinks(user.id, noteId, content);
  revalidatePath("/directory");

  return { ok: true as const, noteId, count: rows.length };
}

/** Highlight counts for the book's detail view. */
export async function countHighlightsAction(documentId: string) {
  const parsed = z.string().uuid().safeParse(documentId);
  if (!parsed.success) return { ok: false as const, error: "Invalid book" };

  const { user } = await requireUser();
  const rows = (await db.execute(sql`
    select count(*)::int as total, count(note)::int as with_notes
    from book_highlights
    where document_id = ${parsed.data} and user_id = ${user.id}
  `)) as unknown as { total: number; with_notes: number }[];

  return { ok: true as const, total: rows[0]?.total ?? 0, withNotes: rows[0]?.with_notes ?? 0 };
}
