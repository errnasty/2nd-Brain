"use server";

import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { quizzes, thinktankCards, thinktankDecks, type QuizQuestion } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { aiAvailable } from "@/lib/ai/provider";
import type { ThinkTankDetail } from "@/lib/ai/thinktank";
import { generateQuiz } from "@/lib/ai/quiz";
import { DEFAULT_QUIZ_COUNT, DEFAULT_STUDY_DIFFICULTY } from "@/lib/ai/study-options";
import { getUserSettings } from "@/lib/settings/store";
import { awardXp } from "@/lib/gamify/award";
import { createNoteAction } from "@/app/(app)/directory/actions";
import { createCardsFromTextAction } from "@/app/(app)/review/actions";

/**
 * Start a new deck: a fast insert with status "generating", returned in well
 * under a second. The slow AI work runs in /api/thinktank/generate, which the
 * reader kicks and polls — a held-open 10–30s response was getting severed by
 * the serverless timeout and surfacing as an error even though the deck built
 * fine.
 */
export async function createThinkTankDeckAction(
  rawTopic: string,
  detail: ThinkTankDetail = "standard",
  pacing: "free" | "daily" = "free",
) {
  const topic = (rawTopic ?? "").trim().slice(0, 200);
  if (!topic) return { ok: false as const, error: "Enter a topic to learn" };
  const { user } = await requireUser();

  if (!aiAvailable() && !process.env.ANTHROPIC_API_KEY) {
    return { ok: false as const, error: "AI isn't configured — add an API key in Settings" };
  }
  const rl = await checkRateLimit(user.id, "analyze", 20, 60);
  if (!rl.allowed) {
    return { ok: false as const, error: "Too many generations — try again in a bit" };
  }

  try {
    const [inserted] = await db
      .insert(thinktankDecks)
      .values({
        userId: user.id,
        topic,
        title: topic, // placeholder until generation writes the polished title
        status: "generating",
        detail,
        pacing,
      })
      .returning({ id: thinktankDecks.id });
    revalidatePath("/thinktank");
    return { ok: true as const, deckId: inserted.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Couldn't start the deck";
    console.error("createThinkTankDeckAction failed:", msg);
    return { ok: false as const, error: msg };
  }
}

/** Light status probe for the reader's generation poll. */
export async function getDeckStatusAction(deckId: string) {
  const { user } = await requireUser();
  const [row] = await db
    .select({
      status: thinktankDecks.status,
      cardCount: sql<number>`(select count(*)::int from ${thinktankCards} c where c.deck_id = ${thinktankDecks.id})`,
    })
    .from(thinktankDecks)
    .where(and(eq(thinktankDecks.id, deckId), eq(thinktankDecks.userId, user.id)))
    .limit(1);
  if (!row) return { ok: false as const };
  return { ok: true as const, status: row.status, cardCount: row.cardCount };
}

/** Save one idea card into the Directory as a note (idempotent per card). */
export async function saveCardToLibraryAction(cardId: string) {
  const { user } = await requireUser();
  try {
    const [card] = await db
      .select()
      .from(thinktankCards)
      .where(and(eq(thinktankCards.id, cardId), eq(thinktankCards.userId, user.id)))
      .limit(1);
    if (!card) return { ok: false as const, error: "Card not found" };
    if (card.savedItemId) return { ok: true as const, itemId: card.savedItemId, alreadySaved: true };

    const [deck] = await db
      .select({ topic: thinktankDecks.topic })
      .from(thinktankDecks)
      .where(eq(thinktankDecks.id, card.deckId))
      .limit(1);

    const libraryRefs = card.sourceRefs.filter((r) => r.itemId);
    const webRefs = card.sourceRefs.filter((r) => !r.itemId && r.url);
    const refs =
      (libraryRefs.length > 0
        ? `\n\n**Related in your library:**\n${libraryRefs.map((r) => `- [[${r.title}]]`).join("\n")}`
        : "") +
      (webRefs.length > 0
        ? `\n\n**Sources:**\n${webRefs.map((r) => `- [${r.title}](${r.url})`).join("\n")}`
        : "");
    const r = await createNoteAction({
      title: card.title,
      content: `${card.body}${refs}\n\n— From ThinkTank: ${deck?.topic ?? "a deck"}`,
      folderId: null,
    });
    if (!r.ok) return { ok: false as const, error: r.error };

    await db
      .update(thinktankCards)
      .set({ savedItemId: r.itemId, updatedAt: new Date() })
      .where(eq(thinktankCards.id, card.id));
    revalidatePath("/thinktank");
    return { ok: true as const, itemId: r.itemId, alreadySaved: false };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Couldn't save the card";
    console.error("saveCardToLibraryAction failed:", msg);
    return { ok: false as const, error: msg };
  }
}

/** Turn one idea card into spaced-repetition flashcards (Study deck). */
export async function makeFlashcardsFromCardAction(cardId: string) {
  const { user } = await requireUser();
  try {
    const [card] = await db
      .select({ title: thinktankCards.title, body: thinktankCards.body })
      .from(thinktankCards)
      .where(and(eq(thinktankCards.id, cardId), eq(thinktankCards.userId, user.id)))
      .limit(1);
    if (!card) return { ok: false as const, error: "Card not found" };
    return await createCardsFromTextAction({ title: card.title, text: `${card.title}\n\n${card.body}` });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Couldn't make flashcards";
    console.error("makeFlashcardsFromCardAction failed:", msg);
    return { ok: false as const, error: msg };
  }
}

/** Turn the whole deck into flashcards in one go (finish-card action). */
export async function makeFlashcardsFromDeckAction(deckId: string) {
  const { user } = await requireUser();
  try {
    const [deck] = await db
      .select({ title: thinktankDecks.title })
      .from(thinktankDecks)
      .where(and(eq(thinktankDecks.id, deckId), eq(thinktankDecks.userId, user.id)))
      .limit(1);
    if (!deck) return { ok: false as const, error: "Deck not found" };

    const cards = await db
      .select({ title: thinktankCards.title, body: thinktankCards.body })
      .from(thinktankCards)
      .where(and(eq(thinktankCards.deckId, deckId), eq(thinktankCards.userId, user.id)))
      .orderBy(asc(thinktankCards.position));
    if (cards.length === 0) return { ok: false as const, error: "This deck has no cards yet" };

    const text = cards.map((c) => `## ${c.title}\n\n${c.body}`).join("\n\n");
    return await createCardsFromTextAction({ title: deck.title, text });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Couldn't make flashcards";
    console.error("makeFlashcardsFromDeckAction failed:", msg);
    return { ok: false as const, error: msg };
  }
}

/** Generate a quiz over the deck's cards (finish-card action). Returns the
 *  quiz id; the client routes to the Study hub's quiz tab to take it. */
export async function makeQuizFromDeckAction(deckId: string) {
  const { user } = await requireUser();
  try {
    const [deck] = await db
      .select({ title: thinktankDecks.title })
      .from(thinktankDecks)
      .where(and(eq(thinktankDecks.id, deckId), eq(thinktankDecks.userId, user.id)))
      .limit(1);
    if (!deck) return { ok: false as const, error: "Deck not found" };

    const cards = await db
      .select({ title: thinktankCards.title, body: thinktankCards.body })
      .from(thinktankCards)
      .where(and(eq(thinktankCards.deckId, deckId), eq(thinktankCards.userId, user.id)))
      .orderBy(asc(thinktankCards.position));
    if (cards.length === 0) return { ok: false as const, error: "This deck has no cards yet" };

    const settings = await getUserSettings(user.id);
    const text = cards.map((c) => `## ${c.title}\n\n${c.body}`).join("\n\n");
    const questions = await generateQuiz([{ title: deck.title, text }], {
      count: settings.quizCount ?? DEFAULT_QUIZ_COUNT,
      difficulty: settings.quizDifficulty ?? DEFAULT_STUDY_DIFFICULTY,
    });
    if (questions.length === 0) {
      return {
        ok: false as const,
        error: aiAvailable() ? "Couldn't generate a quiz from this deck — try again" : "AI isn't configured — add an API key in Settings",
      };
    }

    const withIds: QuizQuestion[] = questions.map((q) => ({ ...q, id: randomUUID() }));
    const [row] = await db
      .insert(quizzes)
      .values({ userId: user.id, title: `Quiz: ${deck.title}`.slice(0, 200), itemIds: [], questions: withIds })
      .returning({ id: quizzes.id });

    await awardXp(user.id, { source: "quiz_made", refKind: "quiz_made", refId: row.id });
    revalidatePath("/study");
    return { ok: true as const, quizId: row.id, count: withIds.length };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Couldn't create the quiz";
    console.error("makeQuizFromDeckAction failed:", msg);
    return { ok: false as const, error: msg };
  }
}

/** Award finish XP once per deck — called when the reader hits the finish
 *  card. Idempotent via the xp_events (source, refKind, refId) dedupe. */
export async function markDeckFinishedAction(deckId: string) {
  const { user } = await requireUser();
  try {
    const [deck] = await db
      .select({ id: thinktankDecks.id })
      .from(thinktankDecks)
      .where(and(eq(thinktankDecks.id, deckId), eq(thinktankDecks.userId, user.id)))
      .limit(1);
    if (!deck) return { ok: false as const };
    const xp = await awardXp(user.id, {
      source: "deck_finished",
      refKind: "thinktank_deck_finished",
      refId: deckId,
    });
    return { ok: true as const, xp };
  } catch {
    // Fire-and-forget from the client — losing the award is not worth an error.
    return { ok: false as const };
  }
}

/** Persist the reader's resume position (fire-and-forget from the client). */
export async function setDeckPositionAction(deckId: string, position: number) {
  const { user } = await requireUser();
  const pos = Math.max(0, Math.floor(position));
  try {
    await db
      .update(thinktankDecks)
      .set({ lastPosition: pos, updatedAt: new Date() })
      .where(and(eq(thinktankDecks.id, deckId), eq(thinktankDecks.userId, user.id)));
    return { ok: true as const };
  } catch {
    return { ok: false as const };
  }
}

export async function deleteDeckAction(deckId: string) {
  const { user } = await requireUser();
  try {
    await db
      .delete(thinktankDecks)
      .where(and(eq(thinktankDecks.id, deckId), eq(thinktankDecks.userId, user.id)));
    revalidatePath("/thinktank");
    return { ok: true as const };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Couldn't delete the deck";
    console.error("deleteDeckAction failed:", msg);
    return { ok: false as const, error: msg };
  }
}
