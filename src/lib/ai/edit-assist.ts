import { generateText } from "ai";
import { aiAvailable } from "./provider";
import { userFastModel } from "./user-model";

export type EditAssistMode = "rewrite" | "summarize" | "continue";

const MAX_SELECTION = 4000;
const MAX_CONTEXT = 1500;

const MODE_INSTRUCTION: Record<EditAssistMode, string> = {
  rewrite:
    "Rewrite the selected passage to be clearer and tighter while preserving its exact meaning.",
  summarize: "Summarize the selected passage into a shorter version that keeps the essential meaning.",
  continue:
    "Continue writing the next passage, matching the voice and style established so far. Do not repeat or restate what's already written.",
};

/**
 * Rewrite/summarize a selection, or continue writing from the cursor, for a
 * note being edited. One fast-model call; returns null on no-key/empty-input/
 * error so the caller can quietly no-op (same contract as generateFlashcards).
 */
export async function editAssist(
  mode: EditAssistMode,
  selection: string,
  ctx: { title: string; before: string; after: string },
): Promise<string | null> {
  if (!aiAvailable()) return null;
  if (mode !== "continue" && !selection.trim()) return null;

  const clippedSelection = selection.slice(0, MAX_SELECTION);
  const before = ctx.before.slice(-MAX_CONTEXT);
  const after = ctx.after.slice(0, MAX_CONTEXT);

  const promptParts = [`Title: ${ctx.title}`];
  if (before.trim()) promptParts.push(`Text immediately before:\n${before}`);
  if (mode === "continue") {
    if (clippedSelection.trim()) promptParts.push(`Selected text (for context only):\n${clippedSelection}`);
  } else {
    promptParts.push(`Selected text to ${mode}:\n${clippedSelection}`);
  }
  if (after.trim()) promptParts.push(`Text immediately after:\n${after}`);

  try {
    const { text } = await generateText({
      model: await userFastModel(),
      system: `You are a writing assistant editing a personal note.

${MODE_INSTRUCTION[mode]}

Return ONLY the replacement text — no preamble, no quotation marks, no explanation of what you did.`,
      prompt: promptParts.join("\n\n"),
    });
    const result = text.trim();
    return result.length > 0 ? result : null;
  } catch (err) {
    console.warn("editAssist failed:", err instanceof Error ? err.message : err);
    return null;
  }
}
