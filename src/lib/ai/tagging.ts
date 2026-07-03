import { generateObject } from "ai";
import { z } from "zod";
import { aiAvailable, fastModel } from "./provider";

const TagSchema = z.object({
  tags: z.array(z.string().min(1).max(40)).min(2).max(5),
});

/**
 * Asks Claude Haiku to return 3-5 short tags for an article, strongly preferring
 * reuse of the user's existing tag vocabulary. Returns [] on any failure so
 * callers can fall back gracefully (missing API key, model errors, etc.).
 */
export async function generateTags(
  title: string,
  content: string,
  existingTagNames: string[],
): Promise<string[]> {
  if (!aiAvailable()) return [];

  const existing =
    existingTagNames.length > 0 ? existingTagNames.slice(0, 200).join(", ") : "(none yet)";

  try {
    const { object } = await generateObject({
      model: fastModel(),
      schema: TagSchema,
      system: `You generate 3-5 short, descriptive tags for an article.

Existing tag vocabulary the user already has (REUSE these whenever there's a reasonable fit):
${existing}

Rules:
- 1-3 words per tag, all lowercase
- One concept per tag
- Strongly prefer existing tags — only invent a new one if no existing tag fits
- Tags should help the user navigate their knowledge library`,
      prompt: `Title: ${title}\n\n${content.slice(0, 3000)}`,
    });
    return object.tags.map((t) => t.trim().toLowerCase()).filter(Boolean);
  } catch (err) {
    console.warn("generateTags failed:", err instanceof Error ? err.message : err);
    return [];
  }
}

/** Lowercase + alphanumeric slug for the per-user unique tag constraint. */
export function tagSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
