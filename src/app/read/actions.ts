"use server";

import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  bookChapters,
  bookReadingState,
  directoryItems,
  documents,
  userSettings,
  xpEvents,
} from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { advanceFurthest } from "@/lib/books/progress";
import { awardXp, type AwardResult } from "@/lib/gamify/award";
import { LINE_HEIGHT_STEPS } from "@/lib/books/typography";
import { bookFinishXp, chapterCounts } from "@/lib/gamify/rules";

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

  // Reaching the end of a chapter pays, so a book rewards the evenings that
  // read it and not only the day it is finished. The test itself is free — it
  // is made of numbers the query above already returned — but this runs on
  // every position save, which is every page turn plus a debounce, and a reader
  // lingering on the last page of a chapter would otherwise re-ask the whole
  // award machinery a few times a minute. So the ledger is checked first, and
  // the only path that costs anything is the one that actually pays. `awardXp`
  // still guards the race; this is about the common case, not correctness.
  let xp: AwardResult | null = null;
  if (chapterCounts(charOffset, current) && !(await chapterAlreadyPaid(user.id, documentId, chapterIdx))) {
    xp = await awardXp(user.id, {
      source: "chapter_read",
      itemId: await bookItemId(user.id, documentId),
      useAI: false,
      refKind: "chapter_read",
      refId: `${documentId}:${chapterIdx}`,
    });
    if (xp.skipped || xp.awarded <= 0) xp = null;
  }

  return { ok: true as const, progressPct, xp };
}

/** Has this chapter already been paid for? One indexed lookup on the ledger. */
async function chapterAlreadyPaid(
  userId: string,
  documentId: string,
  chapterIdx: number,
): Promise<boolean> {
  try {
    const [row] = await db
      .select({ id: xpEvents.id })
      .from(xpEvents)
      // All four columns of `xp_events_ref_unique`, in its order, so this is a
      // single index probe on a path that runs on every page turn.
      .where(
        and(
          eq(xpEvents.userId, userId),
          eq(xpEvents.source, "chapter_read"),
          eq(xpEvents.refKind, "chapter_read"),
          eq(xpEvents.refId, `${documentId}:${chapterIdx}`),
        ),
      )
      .limit(1);
    return !!row;
  } catch {
    // Unreadable ledger: fall through to awardXp, which checks again anyway.
    return false;
  }
}

/**
 * The Directory item a book lives in — the thing that decides which skill its
 * XP feeds. Null when the book has no item (an ePub uploaded before the
 * Directory linked them), in which case the award is player-only rather than
 * being pushed into some arbitrary skill.
 */
async function bookItemId(userId: string, documentId: string): Promise<string | null> {
  const [item] = await db
    .select({ id: directoryItems.id })
    .from(directoryItems)
    .where(and(eq(directoryItems.documentId, documentId), eq(directoryItems.userId, userId)))
    .limit(1);
  return item?.id ?? null;
}

/**
 * Mark a book read, or put it back on the pile.
 *
 * Finishing pays the biggest single XP award in the app, scaled by the book's
 * length (see `bookFinishXp`) — a book is weeks of reading, and the economy
 * should say so. The award is keyed on the book itself, so putting a book back
 * on the pile and marking it read again pays nothing the second time; the XP
 * already granted is deliberately NOT clawed back, because un-marking is
 * normally a correction to the shelf, not a claim that the reading undid
 * itself.
 */
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

  let xp: AwardResult | null = null;
  if (finishedAt) xp = await awardBookFinish(user.id, documentId.data);

  return { ok: true as const, finishedAt: finishedAt?.toISOString() ?? null, xp };
}

/**
 * The XP half of finishing a book, kept out of the action above so the shelf
 * state is written whatever happens here. `awardXp` never throws, and the two
 * lookups it needs are cheap: the book's total length (which sets the size of
 * the award) and its Directory item (which decides WHICH skill the XP lands
 * in — a book in "Systems Design" should level up Systems Design, not a
 * generic Reading bucket).
 */
async function awardBookFinish(userId: string, documentId: string): Promise<AwardResult | null> {
  try {
    const [[lengths], itemId] = await Promise.all([
      db
        .select({ chars: sql<number>`coalesce(sum(${bookChapters.charCount}), 0)::int` })
        .from(bookChapters)
        .where(and(eq(bookChapters.documentId, documentId), eq(bookChapters.userId, userId))),
      bookItemId(userId, documentId),
    ]);

    return await awardXp(userId, {
      source: "book_finished",
      amount: bookFinishXp(lengths?.chars ?? 0),
      itemId,
      // The item's cached/folder skill is the right answer here; running the
      // AI classifier over a whole book at the finish line is not.
      useAI: false,
      refKind: "book_finished",
      refId: documentId,
    });
  } catch (err) {
    console.warn("awardBookFinish failed:", err instanceof Error ? err.message : err);
    return null;
  }
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

const TypographySchema = z.object({
  font: z.enum(["serif", "sans"]).optional(),
  lineHeight: z
    .number()
    .refine((n) => LINE_HEIGHT_STEPS.some((s) => s.value === n), "Unknown line height")
    .optional(),
  margin: z.enum(["narrow", "normal", "wide"]).optional(),
});

/**
 * Reader typography, stored on the account rather than on the book.
 *
 * Line spacing, margins and the typeface are about the reader, not about what
 * they happen to be reading, so setting them once should hold for every book —
 * which is exactly the opposite of type size and page colour, and why those
 * two stay on `book_reading_state`.
 *
 * The write is a jsonb shallow merge of only the keys sent, so two settings
 * changed in quick succession can't overwrite one another, and every value is
 * validated first: this ends up in CSS, and an unchecked line height is a book
 * rendered as overlapping lines with no way back except editing the database.
 */
export async function setBookTypographyAction(input: {
  font?: "serif" | "sans";
  lineHeight?: number;
  margin?: "narrow" | "normal" | "wide";
}) {
  const parsed = TypographySchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid typography" };

  const patch = Object.fromEntries(
    Object.entries(parsed.data).filter(([, v]) => v !== undefined),
  );
  if (Object.keys(patch).length === 0) return { ok: true as const };

  const { user } = await requireUser();
  // Merged one level deeper than the generic settings write: `bookReader` is
  // itself an object, and `||` at the top level would replace the whole of it,
  // so changing the margin would silently reset the typeface.
  await db
    .insert(userSettings)
    .values({ userId: user.id, settings: { bookReader: patch }, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: userSettings.userId,
      set: {
        // The nested value is type-checked, not just coalesced: `||` between a
        // jsonb string and a jsonb object raises, so a `bookReader` key that
        // somehow holds anything but an object would turn every save of a
        // reading preference into a 500 with no way to clear it from the app.
        settings: sql`jsonb_set(
          coalesce(${userSettings.settings}, '{}'::jsonb),
          '{bookReader}',
          case
            when jsonb_typeof(${userSettings.settings} -> 'bookReader') = 'object'
              then ${userSettings.settings} -> 'bookReader'
            else '{}'::jsonb
          end || ${JSON.stringify(patch)}::jsonb,
          true
        )`,
        updatedAt: new Date(),
      },
    });

  return { ok: true as const };
}
