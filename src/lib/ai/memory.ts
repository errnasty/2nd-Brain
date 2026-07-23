import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { askMemory } from "@/lib/db/schema";

const MAX_FACTS = 40;

/** The user's remembered facts, newest first. Fail-soft → []. */
export async function getMemory(userId: string): Promise<{ id: string; fact: string }[]> {
  try {
    return await db
      .select({ id: askMemory.id, fact: askMemory.fact })
      .from(askMemory)
      .where(eq(askMemory.userId, userId))
      .orderBy(desc(askMemory.createdAt))
      .limit(MAX_FACTS);
  } catch {
    return [];
  }
}

/** Compact block for injecting remembered facts into a system prompt. */
export async function memoryBlock(userId: string): Promise<string> {
  const facts = await getMemory(userId);
  if (facts.length === 0) return "";
  return `\n\nWHAT YOU REMEMBER ABOUT THE USER:\n${facts.map((f) => `- ${f.fact}`).join("\n")}`;
}

/** Save a fact. Deduped case-insensitively against recent facts. Fail-soft. */
export async function addMemory(userId: string, fact: string): Promise<{ ok: boolean }> {
  const clean = fact.trim().slice(0, 400);
  if (!clean) return { ok: false };
  try {
    const existing = await getMemory(userId);
    if (existing.some((f) => f.fact.toLowerCase() === clean.toLowerCase())) return { ok: true };
    await db.insert(askMemory).values({ userId, fact: clean });
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export async function deleteMemory(userId: string, id: string): Promise<{ ok: boolean }> {
  try {
    await db.delete(askMemory).where(and(eq(askMemory.id, id), eq(askMemory.userId, userId)));
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
