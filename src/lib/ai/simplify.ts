import { generateText } from "ai";
import { aiAvailable } from "./provider";
import { userFastModel } from "./user-model";
import { normalizeModelHtml, sanitizeRewrittenTitle } from "./rewrite-output";

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

const SYSTEM_PROMPT = `You rewrite news articles at a simpler reading level, for a reader who is smart but unfamiliar with the subject (or reading in a second language).

You are given ONE SECTION of a longer article. Rewrite just that section. Do not
add an introduction or a conclusion, and do not refer to the rest of the piece.

Rules:
- Output ONLY the rewritten HTML. No preamble, no notes, no code fences.
- HTML, never Markdown. Emphasis is <strong> and <em>; it is NEVER **bold** or
  *italic*. Inline code is <code>, never backticks.
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
    // The prompt asks for HTML; this is what makes it true. Models emit
    // Markdown emphasis regardless of instruction, and `**like this**` renders
    // as literal asterisks in the reader.
    return normalizeModelHtml(text);
  } catch (err) {
    console.warn("simplifyChunk failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Rewrite the headline. Null whenever the result is anything other than a
 * plausible headline — including on failure. The original headline already
 * reads fine, so a rejected rewrite costs nothing, while an accepted bad one
 * drops a paragraph of prose into the article's <h1>.
 */
export async function simplifyTitle(title: string): Promise<string | null> {
  if (!aiAvailable() || !title.trim()) return null;
  try {
    const model = await userFastModel();
    const { text } = await generateText({
      model,
      system:
        "You rewrite a single news headline in plainer language. Keep the meaning and any names or numbers. Output ONLY the rewritten headline, on one line: no quotes, no notes, no explanation, no Markdown, and never more than one sentence.",
      prompt: title,
    });
    return sanitizeRewrittenTitle(text, title);
  } catch (err) {
    console.warn("simplifyTitle failed:", err instanceof Error ? err.message : err);
    return null;
  }
}
