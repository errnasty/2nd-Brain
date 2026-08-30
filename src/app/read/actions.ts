"use server";

import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { bookChapters, bookReadingState, documents } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { advanceFurthest, progressFor } from "@/lib/books/progress";

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

  const chapters = await db
    .select({ idx: bookChapters.idx, charCount: bookChapters.charCount })
    .from(bookChapters)
    .where(and(eq(bookChapters.documentId, documentId), eq(bookChapters.userId, user.id)))
    .orderBy(asc(bookChapters.idx));

  const progressPct = progressFor(chapters, { chapterIdx, charOffset });

  const [existing] = await db
    .select({ furthestChapterIdx: bookReadingState.furthestChapterIdx })
    .from(bookReadingState)
    .where(
      and(eq(bookReadingState.documentId, documentId), eq(bookReadingState.userId, user.id)),
    )
    .limit(1);

  // Monotonic: flipping back to re-read an earlier chapter must not re-hide a
  // later one from the spoiler clamp.
  const furthestChapterIdx = advanceFurthest(existing?.furthestChapterIdx ?? 0, chapterIdx);

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
