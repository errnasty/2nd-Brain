import { generateObject } from "ai";
import { z } from "zod";
import { aiAvailable } from "./provider";
import { userFastModel } from "./user-model";

const RouteSchema = z.object({
  folderName: z
    .string()
    .nullable()
    .describe("Exact folder name from the provided list, or null if nothing fits well."),
  confidence: z.number().min(0).max(1),
});

const CONFIDENCE_THRESHOLD = 0.6;

/**
 * Asks Claude Haiku which of the user's existing folders an article should live in.
 * Returns `{ folderName: null }` when no folder is a confident match — callers
 * should then route the article to the [Inbox] folder.
 */
export async function routeToFolder(
  title: string,
  excerpt: string,
  folderNames: string[],
): Promise<{ folderName: string | null; confidence: number }> {
  if (!aiAvailable()) return { folderName: null, confidence: 0 };
  if (folderNames.length === 0) return { folderName: null, confidence: 0 };

  try {
    const { object } = await generateObject({
      model: await userFastModel(),
      schema: RouteSchema,
      system: `You route articles into one of the user's existing folders.

Available folders: ${folderNames.map((n) => `"${n}"`).join(", ")}

Return the EXACT folder name from the list above (copy verbatim), or null if no folder
is a reasonable fit. Confidence is 0-1; if below ${CONFIDENCE_THRESHOLD}, return null.`,
      prompt: `Title: ${title}\n\n${excerpt.slice(0, 800)}`,
    });
    if (
      object.confidence < CONFIDENCE_THRESHOLD ||
      !object.folderName ||
      !folderNames.includes(object.folderName)
    ) {
      return { folderName: null, confidence: object.confidence };
    }
    return object;
  } catch (err) {
    console.warn("routeToFolder failed:", err instanceof Error ? err.message : err);
    return { folderName: null, confidence: 0 };
  }
}
