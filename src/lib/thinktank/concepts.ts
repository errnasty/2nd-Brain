import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { skills, thinktankConcepts, type ThinkTankConcept } from "@/lib/db/schema";
import { generateConceptCard } from "@/lib/ai/concept";
import { recordAiUsage } from "@/lib/ai/budget";
import { retrieveFromDirectory } from "@/lib/ai/rag";
import { conceptName, conceptSlug, isValidConceptName } from "./concept-slug";

/**
 * The concept store: cache-first reads, one generation per genuinely new idea.
 *
 * Every function here treats the `(user_id, slug)` unique index as the
 * authority on whether a card already exists. That index is what makes endless
 * exploration affordable — a mature graph re-reads for free, and only the
 * frontier costs anything.
 */

/** Concepts a card is generated with, for framing. */
const LIBRARY_CONTEXT_LIMIT = 8;

export type ConceptRow = ThinkTankConcept;

/** A concept by slug, or null. */
export async function getConcept(userId: string, slug: string): Promise<ConceptRow | null> {
  const [row] = await db
    .select()
    .from(thinktankConcepts)
    .where(and(eq(thinktankConcepts.userId, userId), eq(thinktankConcepts.slug, slug)))
    .limit(1);
  return row ?? null;
}

/**
 * Reserve a concept so exactly one generation runs for it.
 *
 * The insert is the lock: `onConflictDoNothing` on the unique slug means a
 * second caller (a prefetch racing the tap that triggered it — the common case,
 * not a rare one) gets `null` back and does nothing, rather than both paying
 * for the same card.
 */
export async function reserveConcept(
  userId: string,
  name: string,
  topic: string | null,
): Promise<{ row: ConceptRow; isNew: boolean } | null> {
  if (!isValidConceptName(name)) return null;
  const slug = conceptSlug(name);

  const inserted = await db
    .insert(thinktankConcepts)
    .values({ userId, slug, name: conceptName(name), topic, status: "pending" })
    .onConflictDoNothing({
      target: [thinktankConcepts.userId, thinktankConcepts.slug],
    })
    .returning();

  if (inserted.length > 0) return { row: inserted[0], isNew: true };

  const existing = await getConcept(userId, slug);
  return existing ? { row: existing, isNew: false } : null;
}

/**
 * Names of concepts this user already has, for the near-duplicate check.
 *
 * Capped: this is a guard against fragmentation, not a search index, and the
 * comparison is against names the model just produced — a few hundred is
 * plenty and keeps it one cheap query.
 */
const DEDUPE_SCAN_LIMIT = 400;

export async function existingConceptNames(
  userId: string,
): Promise<{ slug: string; name: string }[]> {
  try {
    return await db
      .select({ slug: thinktankConcepts.slug, name: thinktankConcepts.name })
      .from(thinktankConcepts)
      .where(eq(thinktankConcepts.userId, userId))
      .orderBy(desc(thinktankConcepts.updatedAt))
      .limit(DEDUPE_SCAN_LIMIT);
  } catch {
    return [];
  }
}

/** Library titles near a concept, used to pitch the card at the right level. */
async function libraryContext(userId: string, query: string): Promise<string[]> {
  try {
    const hits = await retrieveFromDirectory(userId, query, LIBRARY_CONTEXT_LIMIT);
    const seen = new Set<string>();
    return hits
      .map((h) => h.title)
      .filter((t) => (seen.has(t) ? false : (seen.add(t), true)))
      .slice(0, LIBRARY_CONTEXT_LIMIT);
  } catch {
    // No embeddings key, empty library — the card is simply less tailored.
    return [];
  }
}

export type FillResult =
  | { ok: true; concept: ConceptRow }
  | { ok: false; error: string };

/**
 * Generate a pending concept's card and store it.
 *
 * Safe to call on a concept that is already `ready` — it returns the existing
 * row untouched rather than regenerating, so a duplicate kick costs nothing.
 */
export async function fillConcept(
  userId: string,
  slug: string,
  opts: { cameFrom?: string | null } = {},
): Promise<FillResult> {
  const concept = await getConcept(userId, slug);
  if (!concept) return { ok: false, error: "Concept not found" };
  if (concept.status === "ready" && concept.whatIsIt) return { ok: true, concept };

  const library = await libraryContext(userId, concept.name);

  const generated = await generateConceptCard(concept.name, {
    topic: concept.topic,
    libraryTitles: library,
    cameFrom: opts.cameFrom ?? null,
  });

  if (!generated) {
    await db
      .update(thinktankConcepts)
      .set({ status: "error", updatedAt: new Date() })
      .where(eq(thinktankConcepts.id, concept.id))
      .catch(() => {});
    return { ok: false, error: "Couldn't write this card — try again" };
  }

  // Charge the day's token budget. Without this the budget guard in the route
  // reads zero spend forever and stops guarding anything.
  if (generated.tokenCount) void recordAiUsage(userId, generated.tokenCount);

  // Point related links at slugs now, so navigation never has to re-derive
  // them and a rename of the display name can't break a link.
  const related = generated.related.map((r) => ({
    name: conceptName(r.name),
    slug: conceptSlug(r.name),
  }));

  const [updated] = await db
    .update(thinktankConcepts)
    .set({
      status: "ready",
      whatIsIt: generated.whatIsIt,
      whyItMatters: generated.whyItMatters,
      realWorldExample: generated.realWorldExample,
      related,
      questions: generated.questions,
      model: generated.model,
      tokenCount: generated.tokenCount,
      updatedAt: new Date(),
    })
    .where(eq(thinktankConcepts.id, concept.id))
    .returning();

  return updated ? { ok: true, concept: updated } : { ok: false, error: "Couldn't save this card" };
}

/** Record that a concept was opened. Drives progress and Discover's evidence. */
export async function markConceptViewed(userId: string, slug: string): Promise<void> {
  try {
    await db
      .update(thinktankConcepts)
      .set({
        viewedAt: new Date(),
        viewCount: sql`${thinktankConcepts.viewCount} + 1`,
      })
      .where(and(eq(thinktankConcepts.userId, userId), eq(thinktankConcepts.slug, slug)));
  } catch {
    // A view counter is not worth failing a page render over.
  }
}

/** Mark a concept as one the user says they already know (or unmark it). */
export async function setConceptFamiliarity(
  userId: string,
  slug: string,
  familiarity: "known" | "new" | null,
): Promise<void> {
  await db
    .update(thinktankConcepts)
    .set({ familiarity, updatedAt: new Date() })
    .where(and(eq(thinktankConcepts.userId, userId), eq(thinktankConcepts.slug, slug)));
}

/** Concepts already read under a topic — Discover's "don't suggest these". */
export async function conceptsSeenForTopic(userId: string, topic: string): Promise<string[]> {
  try {
    const rows = await db
      .select({ name: thinktankConcepts.name })
      .from(thinktankConcepts)
      .where(
        and(
          eq(thinktankConcepts.userId, userId),
          eq(thinktankConcepts.topic, topic),
          isNotNull(thinktankConcepts.viewedAt),
        ),
      )
      .limit(60);
    return rows.map((r) => r.name);
  } catch {
    return [];
  }
}

/** The user's skill names — evidence that they've been working in an area. */
export async function userSkillNames(userId: string): Promise<string[]> {
  try {
    const rows = await db
      .select({ name: skills.name, level: skills.level })
      .from(skills)
      .where(eq(skills.userId, userId))
      .orderBy(desc(skills.xp))
      .limit(15);
    return rows.map((r) => `${r.name} (level ${r.level})`);
  } catch {
    return [];
  }
}

/** How many concepts the user has read under a topic — the progress readout. */
export async function topicProgress(
  userId: string,
  topic: string,
): Promise<{ explored: number; total: number }> {
  try {
    const [row] = (await db.execute(sql`
      select
        count(*) filter (where viewed_at is not null)::int as explored,
        count(*)::int as total
      from thinktank_concepts
      where user_id = ${userId} and topic = ${topic}
    `)) as unknown as { explored: number; total: number }[];
    return { explored: row?.explored ?? 0, total: row?.total ?? 0 };
  } catch {
    return { explored: 0, total: 0 };
  }
}
