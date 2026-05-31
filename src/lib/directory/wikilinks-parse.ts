// Pure, db-free wikilink parsing so it's unit-testable without DATABASE_URL.

const WIKILINK_RE = /\[\[([^\]|]+?)(?:\|[^\]]+)?\]\]/g;

/** Extract distinct link targets ([[Title]] or [[Title|alias]]) from text. */
export function parseWikilinkTitles(text: string | null | undefined): string[] {
  if (!text) return [];
  const out = new Set<string>();
  for (const m of text.matchAll(WIKILINK_RE)) {
    const title = m[1]?.trim();
    if (title) out.add(title);
  }
  return Array.from(out);
}
