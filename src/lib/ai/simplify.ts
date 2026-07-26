import { generateText } from "ai";
import { aiAvailable } from "./provider";
import { userFastModel } from "./user-model";

/**
 * Rewrite article HTML at a plainer reading level while leaving its markup
 * intact.
 *
 * This is a rewrite, not a summary. Dropping information would quietly turn
 * "hard to read" into "no longer the article", so the prompt forbids omission.
 *
 * One chunk per call, by design. The caller (the route) handles exactly one
 * chunk per HTTP request because the host kills a synchronous function at ~10s;
 * an earlier version looped over the whole article here and could never finish.
 */

/** Small enough that a single rewrite comfortably fits the host's ~10s ceiling,
 *  large enough that a normal article is a handful of requests, not dozens. */
export const SIMPLIFY_CHUNK_CHARS = 2200;

/** Models like to wrap output in ```html fences even when told not to. */
function stripFence(s: string): string {
  const t = s.trim();
  const m = t.match(/^```(?:html)?\s*\n?([\s\S]*?)\n?```$/i);
  return (m ? m[1] : t).trim();
}

const SYSTEM_PROMPT = `You rewrite news articles at a simpler reading level, for a reader who is smart but unfamiliar with the subject (or reading in a second language).

You are given ONE SECTION of a longer article. Rewrite just that section. Do not
add an introduction or a conclusion, and do not refer to the rest of the piece.

Rules:
- Output ONLY the rewritten HTML. No preamble, no notes, no code fences.
- Preserve the HTML structure EXACTLY: same tags, same attributes, same order.
  Rewrite only human-readable text between tags.
- Never alter URLs, href/src values, code, or content inside <code>/<pre>.
- NEVER omit information. Every fact, name, number, date, quote and caveat in the
  source must still be present. This is a rewrite, not a summary — do not shorten
  the section by leaving things out.
- Break long sentences into shorter ones. One idea per sentence.
- Prefer everyday words over specialist ones. Use the active voice.
- The first time a piece of jargon or an acronym is unavoidable, define it inline
  in a few words, then keep using it.
- Do not add opinions, conclusions, or context that is not in the source.
- Keep the tone factual and neutral. Do not talk down to the reader.`;

/**
 * Rewrite a single chunk of article HTML. Returns null when AI is unavailable
 * or the call fails, so the caller can degrade to the original rather than
 * pasting an error into the body.
 */
export async function simplifyChunk(html: string): Promise<string | null> {
  if (!aiAvailable()) return null;
  if (!html.trim()) return "";
  try {
    const model = await userFastModel();
    const { text } = await generateText({ model, system: SYSTEM_PROMPT, prompt: html });
    return stripFence(text);
  } catch (err) {
    console.warn("simplifyChunk failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

/** Rewrite the headline. Null on failure — the original headline still reads
 *  fine, so this is never worth failing the whole request over. */
export async function simplifyTitle(title: string): Promise<string | null> {
  if (!aiAvailable() || !title.trim()) return null;
  try {
    const model = await userFastModel();
    const { text } = await generateText({
      model,
      system:
        "You rewrite news headlines in plainer language. Keep the meaning and any names or numbers. Output ONLY the rewritten headline — no quotes, no notes.",
      prompt: title,
    });
    return text.trim() || null;
  } catch (err) {
    console.warn("simplifyTitle failed:", err instanceof Error ? err.message : err);
    return null;
  }
}
