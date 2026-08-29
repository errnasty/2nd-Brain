/**
 * Pure markdown helpers for the note viewer/editor.
 *
 * Everything here operates on the raw markdown string that lives in
 * `directory_items.content` — that text is the source of truth for embeddings,
 * wikilinks, AI edit-assist and export, so these helpers never reformat it.
 * They only read it, or change the single line they were asked to change.
 */

export type NoteHeading = {
  /** 1–6 */
  level: number;
  /** Heading text with markdown syntax stripped. */
  text: string;
  /** Unique within the document — used as the rendered anchor id. */
  slug: string;
  /** 1-indexed source line. */
  line: number;
};

const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/;
const ATX_RE = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const TASK_RE = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\]\s?)/;

/** Strip the inline markdown that would otherwise show up in an outline entry. */
function stripInline(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1") // images
    .replace(/\[\[([^\]|]+?)(?:\|([^\]]+))?\]\]/g, (_m, t, alias) => alias ?? t) // wikilinks
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links
    .replace(/`([^`]*)`/g, "$1") // inline code
    .replace(/(\*\*\*|___)(.*?)\1/g, "$2")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/~~(.*?)~~/g, "$1")
    .trim();
}

export function slugify(text: string): string {
  const base = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");
  return base || "section";
}

/**
 * Headings in document order, skipping anything inside a fenced code block —
 * `# not a heading` inside a ``` fence is code, not structure.
 *
 * Slugs are made unique with a `-2`, `-3`… suffix so two "Notes" headings still
 * scroll to different places.
 */
export function extractHeadings(md: string): NoteHeading[] {
  if (!md) return [];
  const out: NoteHeading[] = [];
  const seen = new Map<string, number>();
  let fence: string | null = null;

  const lines = md.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];

    const fenceMatch = FENCE_RE.exec(raw);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (fence === null) fence = marker;
      else if (fence === marker) fence = null;
      continue;
    }
    if (fence !== null) continue;

    const m = ATX_RE.exec(raw);
    if (!m) continue;

    const text = stripInline(m[2]);
    if (!text) continue;

    const base = slugify(text);
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);

    out.push({
      level: m[1].length,
      text,
      slug: count === 1 ? base : `${base}-${count}`,
      line: i + 1,
    });
  }
  return out;
}

/**
 * Flip `- [ ]` <-> `- [x]` on a 1-indexed source line.
 *
 * Returns `null` when the line is out of range or is not a task item, so the
 * caller can no-op rather than write an identical string back to the server.
 */
export function toggleTaskAtLine(md: string, line: number): string | null {
  const lines = md.split("\n");
  const idx = line - 1;
  if (idx < 0 || idx >= lines.length) return null;

  const m = TASK_RE.exec(lines[idx]);
  if (!m) return null;

  const next = m[2] === " " ? "x" : " ";
  lines[idx] = lines[idx].replace(TASK_RE, `$1${next}$3`);
  return lines.join("\n");
}

export type WordStats = { words: number; minutes: number };

/**
 * Word count over the prose only: fenced code, inline code and link targets are
 * dropped first so a note full of snippets does not report a fake reading time.
 */
export function wordStats(md: string): WordStats {
  const prose = (md ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/~~~[\s\S]*?~~~/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, " $1 ")
    .replace(/\[\[([^\]|]+?)(?:\|([^\]]+))?\]\]/g, (_m, t, alias) => ` ${alias ?? t} `)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, " $1 ")
    .replace(/^\s{0,3}#{1,6}\s+/gm, " ")
    .replace(/[*_>~#|-]/g, " ");

  const words = prose.split(/\s+/).filter(Boolean).length;
  // 220 wpm, and anything non-empty is at least a 1-minute read.
  return { words, minutes: words === 0 ? 0 : Math.max(1, Math.round(words / 220)) };
}
