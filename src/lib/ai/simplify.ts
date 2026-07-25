import { generateText } from "ai";
import { aiAvailable } from "./provider";
import { userFastModel } from "./user-model";
import { chunkHtml } from "./translate";

/**
 * Rewrite article HTML at a plainer reading level while leaving its markup
 * intact — the same shape as translation, because it is the same problem:
 * rewrite the prose, keep the article an article.
 *
 * This is a rewrite, not a summary. Dropping information would quietly turn
 * "hard to read" into "no longer the article", so the prompt forbids omission
 * and the chunking (shared with translate) exists to stop a long piece losing
 * its tail to output truncation.
 */

/** Models like to wrap output in ```html fences even when told not to. */
function stripFence(s: string): string {
  const t = s.trim();
  const m = t.match(/^```(?:html)?\s*\n?([\s\S]*?)\n?```$/i);
  return (m ? m[1] : t).trim();
}

const SYSTEM_PROMPT = `You rewrite news articles at a simpler reading level, for a reader who is smart but unfamiliar with the subject (or reading in a second language).

Rules:
- Output ONLY the rewritten HTML. No preamble, no notes, no code fences.
- Preserve the HTML structure EXACTLY: same tags, same attributes, same order.
  Rewrite only human-readable text between tags.
- Never alter URLs, href/src values, code, or content inside <code>/<pre>.
- NEVER omit information. Every fact, name, number, date, quote and caveat in the
  source must still be present. This is a rewrite, not a summary — do not shorten
  the article by leaving things out.
- Break long sentences into shorter ones. One idea per sentence.
- Prefer everyday words over specialist ones. Use the active voice.
- The first time a piece of jargon or an acronym is unavoidable, define it inline
  in a few words, then keep using it.
- Do not add opinions, conclusions, or context that is not in the source.
- Keep the tone factual and neutral. Do not talk down to the reader.`;

export type Simplified = { title: string; content: string };

/**
 * Simplify a title + HTML body. Returns null when AI is unavailable or the call
 * fails, so callers degrade to showing the original rather than an error.
 */
export async function simplifyArticle(title: string, html: string): Promise<Simplified | null> {
  if (!aiAvailable()) return null;

  try {
    const model = await userFastModel();

    const titleP = title.trim()
      ? generateText({
          model,
          system:
            "You rewrite news headlines in plainer language. Keep the meaning and any names or numbers. Output ONLY the rewritten headline — no quotes, no notes.",
          prompt: title,
        }).then((r) => r.text.trim())
      : Promise.resolve("");

    const chunks = chunkHtml(html);
    // Sequential, same reasoning as translation: the fast model is rate-limited,
    // and a burst of parallel calls on a long article gets throttled half-way
    // through and loses the rest of the piece.
    const out: string[] = [];
    for (const chunk of chunks) {
      const { text } = await generateText({ model, system: SYSTEM_PROMPT, prompt: chunk });
      out.push(stripFence(text));
    }

    const simpleTitle = await titleP;
    return { title: simpleTitle || title, content: out.join("") };
  } catch (err) {
    console.warn("simplifyArticle failed:", err instanceof Error ? err.message : err);
    return null;
  }
}
