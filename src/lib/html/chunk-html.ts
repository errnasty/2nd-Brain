/**
 * Split article HTML into model/service-sized chunks without ever cutting a
 * tag in half.
 *
 * Both the reader's rewrite paths (translate, simplify) process one chunk per
 * HTTP request, because the host kills a synchronous function at ~10s. Chunking
 * has to be deterministic for that to work: request N must always describe the
 * same slice of the stored body, with no server-side session state.
 */

/** Conservative default in characters, not tokens — callers that know their
 *  own budget (MT is far cheaper per character than a model) pass their own. */
const CHUNK_CHARS = 3500;

/**
 * Split HTML at top-level tag boundaries, never inside a tag. Falls back to
 * hard slicing for a single enormous block so a pathological input can't loop.
 */
export function chunkHtml(html: string, limit = CHUNK_CHARS): string[] {
  // Nothing to rewrite — same answer whatever the length, so the caller never
  // spends a request on whitespace.
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
