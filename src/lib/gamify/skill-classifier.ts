import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";

const HAIKU = "claude-haiku-4-5-20251001";

const SkillSchema = z.object({
  // Reuse an existing skill name when the content fits one; else a concise new one.
  name: z.string().min(2).max(40),
  emoji: z.string().min(1).max(8),
});

export type ClassifiedSkill = { name: string; emoji: string };

/**
 * Pick (or invent) the single skill an item best builds. One Haiku call; returns
 * null on failure so the caller falls back to folder/General. Run once per item
 * and cache the result — never on every micro-action.
 */
export async function classifyItemSkills(
  title: string,
  content: string,
  existingSkills: string[],
): Promise<ClassifiedSkill | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!title.trim() && !content.trim()) return null;

  try {
    const { object } = await generateObject({
      model: anthropic(HAIKU),
      schema: SkillSchema,
      system: `You assign learning content to ONE skill the user is building.

Rules:
- Prefer an EXISTING skill name when the content fits it (case-insensitive match).
- Otherwise coin a short, broad, reusable skill (e.g. "Machine Learning", not "Chapter 3 notes").
- emoji: a single representative emoji.
- Skills are durable areas of mastery, not document titles.`,
      prompt: `Existing skills: ${existingSkills.length ? existingSkills.join(", ") : "(none yet)"}

Title: ${title}

Content: ${content.slice(0, 3000)}`,
    });
    return object;
  } catch (err) {
    console.warn("classifyItemSkills failed:", err instanceof Error ? err.message : err);
    return null;
  }
}
