import { generateText } from "ai";
import { aiAvailable } from "./provider";
import { userFastModel } from "./user-model";
import { languageName } from "@/lib/i18n/detect-language";

/**
 * Translate article HTML while leaving its markup intact, so a translated
 * article still reads as an article — headings, paragraphs, links, blockquotes
 * and images all survive.
 *
 * Long articles are split on top-level block boundaries and translated in
 * sequence: one oversized prompt risks truncation mid-article (the model runs
 * out of output budget and the tail silently vanishes), which is a much worse
 * failure than a couple of extra calls.
 */

/** Roughly a model-friendly chunk. Characters, not tokens — deliberately
 *  conservative so even dense CJK source text stays inside the output budget. */
const CHUNK_CHARS = 3500;

/**
 * Split HTML at top-level tag boundaries, never inside a tag. Falls back to
 * hard slicing for a single enormous block so a pathological input can't loop.
 */
export function chunkHtml(html: string, limit = CHUNK_CHARS): string[] {
  // Nothing translatable — same answer whatever the length, so the caller
  // never burns a model call on whitespace.
  if (!html.trim()) return [];
  if (html.length <= limit) return [html];
  const chunks: string[] = [];
  let cur = "";
  // Keep the delimiter: split before each top-level closing-then-opening seam.
  const parts = html.split(/(?<=>)(?=<(?:p|div|h[1-6]|ul|ol|li|blockquote|figure|section|article|pre|table)\b)/i);
  for (const part of parts) {
    if (part.length > limit) {
      if (cur) {
        chunks.push(cur);
        cur = "";
      }
      for (let i = 0; i < part.length; i += limit) chunks.push(part.slice(i, i + limit));
      continue;
    }
    if (cur.length + part.length > limit) {
      chunks.push(cur);
      cur = part;
    } else {
      cur += part;
    }
  }
  if (cur) chunks.push(cur);
  return chunks.filter((c) => c.trim().length > 0);
}

/** Models like to wrap output in ```html fences even when told not to. */
function stripFence(s: string): string {
  const t = s.trim();
  const m = t.match(/^```(?:html)?\s*\n?([\s\S]*?)\n?```$/i);
  return (m ? m[1] : t).trim();
}

function systemPrompt(targetName: string): string {
  return `You translate news articles into ${targetName}.

Rules:
- Output ONLY the translation. No preamble, no notes, no code fences.
- Preserve the HTML structure EXACTLY: same tags, same attributes, same order.
  Translate only human-readable text between tags, and alt/title attribute text.
- Never translate URLs, href/src values, code, or content inside <code>/<pre>.
- Keep proper nouns, brand names and quoted names in their original form unless
  a well-established ${targetName} form exists.
- Match the register of news prose: accurate and natural, not literal.
- If a passage is already in ${targetName}, leave it unchanged.`;
}

export type Translation = { title: string; content: string };

/**
 * Translate a title + HTML body. Returns null when AI is unavailable or the
 * call fails, so callers degrade to showing the original rather than an error.
 */
export async function translateArticle(
  title: string,
  html: string,
  target: string,
): Promise<Translation | null> {
  if (!aiAvailable()) return null;
  const targetName = languageName(target);

  try {
    const model = await userFastModel();

    const titleP = title.trim()
      ? generateText({
          model,
          system: `You translate news headlines into ${targetName}. Output ONLY the translated headline — no quotes, no notes.`,
          prompt: title,
        }).then((r) => r.text.trim())
      : Promise.resolve("");

    const chunks = chunkHtml(html);
    // Body chunks run in sequence: the fast model is rate-limited, and a burst
    // of parallel calls on a long article is the quickest way to get throttled
    // half-way through and lose the rest of the piece.
    const out: string[] = [];
    for (const chunk of chunks) {
      const { text } = await generateText({
        model,
        system: systemPrompt(targetName),
        prompt: chunk,
      });
      out.push(stripFence(text));
    }

    const translatedTitle = await titleP;
    return { title: translatedTitle || title, content: out.join("") };
  } catch (err) {
    console.warn("translateArticle failed:", err instanceof Error ? err.message : err);
    return null;
  }
}
