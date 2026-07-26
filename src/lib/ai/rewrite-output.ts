/**
 * Repair and vet what a model returns when it was asked for HTML.
 *
 * Prompts cannot enforce a format. Told "output only HTML", models still emit
 * Markdown emphasis, wrap the lot in a code fence, or — when handed a bare
 * headline to rewrite — answer with three paragraphs explaining the topic
 * instead. Every one of those reaches the reader as garbage: literal `**` in
 * the prose, or an essay rendered in headline type.
 *
 * So nothing here asks the model to behave. It checks and fixes the output.
 */

/** Models like to wrap output in ```html fences even when told not to. */
export function stripFence(s: string): string {
  const t = s.trim();
  const m = t.match(/^```(?:html|markdown|md)?\s*\n?([\s\S]*?)\n?```$/i);
  return (m ? m[1] : t).trim();
}

/** Block-level tags that mean "this really is HTML, not Markdown". */
const BLOCK_TAG = /<(p|div|h[1-6]|ul|ol|li|blockquote|figure|table|pre|section|article)\b/i;

/**
 * Convert leaked Markdown emphasis to HTML — but only in the text between
 * tags, never inside one. A blanket regex over the whole string would happily
 * rewrite `<a href="http://x.com/a_b_c">` into something broken.
 */
function markdownToHtmlInText(text: string): string {
  return (
    text
      // Order matters: the two-character markers must be consumed before the
      // one-character ones, or `**x**` degrades into `<em>*x*</em>`.
      .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, "<strong>$1</strong>")
      .replace(/__(?=\S)([\s\S]*?\S)__/g, "<strong>$1</strong>")
      .replace(/(^|[\s(])\*(?=\S)([^*\n]*?\S)\*(?=[\s).,;:!?]|$)/g, "$1<em>$2</em>")
      // Underscore emphasis only between word boundaries, so snake_case names
      // and file_paths in prose survive.
      .replace(/(^|[\s(])_(?=\S)([^_\n]*?\S)_(?=[\s).,;:!?]|$)/g, "$1<em>$2</em>")
      .replace(/`(?=\S)([^`\n]*?)`/g, "<code>$1</code>")
  );
}

/**
 * Clean up model-generated article HTML.
 *
 * Handles the two failure modes seen in practice: Markdown emphasis inside
 * otherwise-fine HTML, and output that is Markdown all the way down with no
 * tags at all (which would render as one unbroken wall of text).
 */
export function normalizeModelHtml(raw: string): string {
  const text = stripFence(raw);
  if (!text.trim()) return "";

  // Split on tags so the transform only ever touches the parts between them.
  const parts = text.split(/(<[^>]*>)/);
  const converted = parts
    .map((part, i) => (i % 2 === 1 ? part : markdownToHtmlInText(part)))
    .join("");

  if (BLOCK_TAG.test(converted)) return converted;

  // No block structure at all: treat blank lines as paragraph breaks, so a
  // Markdown-only answer still reads as an article instead of one long run.
  return converted
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${block.replace(/\n/g, " ")}</p>`)
    .join("");
}

/** Longest a rewritten headline may be, in absolute terms. Headlines that run
 *  past this are prose, whatever they claim to be. */
const TITLE_MAX = 140;

/**
 * Vet a model-rewritten headline, returning null when it should be discarded.
 *
 * A rejected rewrite costs nothing — the original headline was already fine.
 * An accepted bad one puts a paragraph of prose in the `<h1>`, which is what
 * "the formatting is wrong" looks like from the reader's side.
 */
export function sanitizeRewrittenTitle(raw: string, original: string): string | null {
  let t = stripFence(raw);
  // Models often answer a rewrite request conversationally.
  t = t.replace(/^(?:here(?:'s| is)[^:]*:|rewritten headline:|title:)\s*/i, "");
  // Strip Markdown/HTML rather than converting it: a headline is plain text.
  t = t
    .replace(/<[^>]*>/g, "")
    .replace(/[*_`#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  // Surrounding quotes are a habit, not part of the headline.
  t = t.replace(/^["“”'‘’]+|["“”'‘’]+$/g, "").trim();

  if (!t) return null;
  // A multi-line answer is an explanation, not a headline.
  if (/\n/.test(stripFence(raw).trim())) return null;
  if (t.length > TITLE_MAX) return null;
  // Rewriting for plainness can lengthen a headline a little; it cannot
  // reasonably double it. Guard on the original where there is one.
  if (original.trim() && t.length > Math.max(80, original.trim().length * 1.8)) return null;
  // Bracketed source markers ([2], [6]) mean the model answered from sources
  // rather than rewriting the line it was given.
  if (/\[\d+\]/.test(t)) return null;
  return t;
}
