"use server";

import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { bookReadingState, documents } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { advanceFurthest } from "@/lib/books/progress";

const PositionSchema = z.object({
  documentId: z.string().uuid(),
  chapterIdx: z.number().int().min(0),
  charOffset: z.number().int().min(0),
});

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

/**
 * Save where the reader is.
 *
 * Called on a debounce while reading and again when the page is hidden, so it
 * is written to be cheap and idempotent. Progress is recomputed here rather
 * than trusted from the client: it feeds the library's progress bars, and the
 * chapter lengths it needs are already in the database.
 */
export async function saveBookPositionAction(input: {
  documentId: string;
  chapterIdx: number;
  charOffset: number;
}) {
  const parsed = PositionSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid position" };

  const { user } = await requireUser();
  const { documentId, chapterIdx, charOffset } = parsed.data;
  if (!(await assertOwnsBook(documentId, user.id))) {
    return { ok: false as const, error: "Not found" };
  }

  // Two sums and the current chapter's length, in one row. Reading back every
  // chapter of a 400-chapter book to add up two numbers — every 1.5 seconds of
  // reading, for every reader — is the kind of thing that only shows up once
  // someone has a large library.
  const totals = (await db.execute(sql`
    select
      coalesce(sum(char_count), 0)::bigint                                   as total,
      coalesce(sum(char_count) filter (where idx < ${chapterIdx}), 0)::bigint as before,
      coalesce(max(char_count) filter (where idx = ${chapterIdx}), 0)::bigint as current,
      (select furthest_chapter_idx from book_reading_state
        where document_id = ${documentId} and user_id = ${user.id})         as furthest
    from book_chapters
    where document_id = ${documentId} and user_id = ${user.id}
  `)) as unknown as { total: string; before: string; current: string; furthest: number | null }[];

  const row = totals[0];
  const total = Number(row?.total ?? 0);
  const before = Number(row?.before ?? 0);
  const current = Number(row?.current ?? 0);

  // The stored count is an estimate of what the browser renders, so a real
  // offset can overshoot it; clamping keeps progress inside 0..1.
  const read = before + Math.min(Math.max(0, charOffset), current);
  const progressPct = total > 0 ? Math.min(1, read / total) : 0;

  // Monotonic: flipping back to re-read an earlier chapter must not re-hide a
  // later one from the spoiler clamp.
  const furthestChapterIdx = advanceFurthest(row?.furthest ?? 0, chapterIdx);

  await db
    .insert(bookReadingState)
    .values({
      userId: user.id,
      documentId,
      chapterIdx,
      charOffset,
      furthestChapterIdx,
      progressPct,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [bookReadingState.userId, bookReadingState.documentId],
      set: { chapterIdx, charOffset, furthestChapterIdx, progressPct, updatedAt: new Date() },
    });

  return { ok: true as const, progressPct };
}

/** Mark a book read, or put it back on the pile. */
export async function setBookFinishedAction(input: { documentId: string; finished: boolean }) {
  const documentId = z.string().uuid().safeParse(input.documentId);
  if (!documentId.success) return { ok: false as const, error: "Invalid book" };

  const { user } = await requireUser();
  if (!(await assertOwnsBook(documentId.data, user.id))) {
    return { ok: false as const, error: "Not found" };
  }

  const finishedAt = input.finished ? new Date() : null;
  await db
    .insert(bookReadingState)
    .values({ userId: user.id, documentId: documentId.data, finishedAt })
    .onConflictDoUpdate({
      target: [bookReadingState.userId, bookReadingState.documentId],
      set: { finishedAt, updatedAt: new Date() },
    });

  return { ok: true as const, finishedAt: finishedAt?.toISOString() ?? null };
}

const PrefsSchema = z.object({
  documentId: z.string().uuid(),
  // Half size to triple size. Anything outside that is a bug or a fat finger,
  // and a font scale of 0 makes a book that cannot be read or recovered from.
  fontScale: z.number().min(0.5).max(3).optional(),
  theme: z.enum(["app", "paper", "night"]).nullable().optional(),
  spoilerSafe: z.boolean().optional(),
});

/** Per-book reader preferences: type size, page colour, and the spoiler clamp. */
export async function setBookPrefsAction(input: {
  documentId: string;
  fontScale?: number;
  theme?: "app" | "paper" | "night" | null;
  spoilerSafe?: boolean;
}) {
  const parsed = PrefsSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid preferences" };

  const { user } = await requireUser();
  const { documentId, fontScale, theme, spoilerSafe } = parsed.data;
  if (!(await assertOwnsBook(documentId, user.id))) {
    return { ok: false as const, error: "Not found" };
  }

  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (fontScale !== undefined) set.fontScale = fontScale;
  if (theme !== undefined) set.theme = theme;
  if (spoilerSafe !== undefined) set.spoilerSafe = spoilerSafe;

  await db
    .insert(bookReadingState)
    .values({
      userId: user.id,
      documentId,
      fontScale: fontScale ?? 1,
      theme: theme ?? null,
      spoilerSafe: spoilerSafe ?? false,
    })
    .onConflictDoUpdate({
      target: [bookReadingState.userId, bookReadingState.documentId],
      set,
    });

  return { ok: true as const };
}
