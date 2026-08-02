import { generateText } from "ai";
import { aiAvailable } from "./provider";
import { userFastModel } from "./user-model";
import {
  looksLikeMetaCommentary,
  normalizeModelHtml,
  sanitizeRewrittenTitle,
  visibleText,
} from "./rewrite-output";

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

/**
 * Least readable text a chunk must hold before it is worth rewriting.
 *
 * Below this it is a caption, a lone heading, or pure markup — nothing a
 * "simpler reading level" pass can improve, and short enough that asking
 * invites the model to reply about the request instead of performing it.
 */
const MIN_REWRITABLE_CHARS = 24;

/** Below this share of the source's text, a "rewrite" has dropped information
 *  the prompt forbids dropping. */
const MAX_SHRINK = 0.45;

/** Only apply the shrink test to chunks long enough for the ratio to be
 *  meaningful — a two-sentence chunk can legitimately compress a lot. */
const SHRINK_FLOOR_CHARS = 400;

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

  // A chunk can be all markup and no prose — a figure and its image, a lone
  // wrapper `<div>`, or a hard slice that landed between tags. There is
  // nothing in it to rewrite, and handing it over produces the worst outcome
  // available: the model answers conversationally ("I don't see the content
  // yet… please paste the full section"), and that reply becomes the article.
  // Passing it straight through is both correct and a model call saved.
  if (visibleText(html).length < MIN_REWRITABLE_CHARS) return html;

  try {
    const model = await userFastModel();
    const { text } = await generateText({ model, system: SYSTEM_PROMPT, prompt: html });
    // The prompt asks for HTML; this is what makes it true. Models emit
    // Markdown emphasis regardless of instruction, and `**like this**` renders
    // as literal asterisks in the reader.
    const out = normalizeModelHtml(text);

    // Vet the rewrite the same way `sanitizeRewrittenTitle` vets the headline:
    // when it isn't a rewrite, keep the original. The source already reads —
    // it is merely harder than it could be — so a rejected rewrite costs the
    // reader nothing, while an accepted bad one costs them the article.
    // Returning the source rather than null matters: null makes the route fail
    // the whole request, which loses the paragraph instead of just the rewrite.
    if (!out.trim() || looksLikeMetaCommentary(out)) {
      console.warn("simplifyChunk rejected a non-rewrite reply:", visibleText(out).slice(0, 200));
      return html;
    }
    // A rewrite that dropped nearly all the prose is a summary or a refusal,
    // both of which the prompt forbids. Only judged on chunks long enough for
    // the ratio to mean something.
    const before = visibleText(html).length;
    const after = visibleText(out).length;
    if (before >= SHRINK_FLOOR_CHARS && after < before * MAX_SHRINK) {
      console.warn(`simplifyChunk rejected a rewrite that shrank ${before} → ${after} chars`);
      return html;
    }
    return out;
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
