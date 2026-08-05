/**
 * Turning the brief's sections into one document, and checking that a cached
 * set of sections is still that document.
 *
 * ## Why this is out here
 *
 * The brief exists in two shapes at once. While it is being read it is a list
 * of SECTIONS — that is what the progress bar measures, what the desks-read
 * count counts, what earns XP and what feedback attaches to. What gets stored,
 * archived and shown on a second device is one MARKDOWN DOCUMENT, because that
 * is the shape a brief is actually read in and the only shape another device
 * can be handed.
 *
 * Everything that has gone wrong in this area has been the seam between those
 * two: a brief restored as a document had no sections, so every section-keyed
 * feature quietly rendered nothing and it looked as though a morning's reading
 * had been thrown away. The reading state was there the whole time.
 *
 * `sectionsMatchContent` is the check that lets the two be reunited safely —
 * cached sections may only decorate a document they actually assemble into.
 * It lives here, next to the assembler it has to agree with, because the two
 * drifting apart is the one failure that would put read marks on the wrong
 * desks. Same reason and same shape as the fingerprint pair in
 * `brief-queue.ts`.
 */

/** The minimum a block needs to become part of the document. */
export type MarkdownBlock = {
  /** Heading rendered above the text; empty for an already-assembled brief. */
  label: string;
  text: string;
};

/** One section as markdown: its heading, then its prose. */
export function blockMarkdown(b: MarkdownBlock): string {
  const text = b.text.trim();
  if (!text) return "";
  return b.label ? `### ${b.label}\n\n${text}` : text;
}

/**
 * The whole brief as one markdown document — what gets cached, archived and
 * stored server-side. Empty sections are dropped rather than left as a bare
 * heading over nothing.
 */
export function assembleBrief(blocks: MarkdownBlock[]): string {
  return blocks.map(blockMarkdown).filter(Boolean).join("\n\n");
}

/**
 * Whether these sections are the structure of this exact document.
 *
 * The guard against decorating one brief with another's boundaries: a stored
 * brief arrives as text from the server, the section structure comes from this
 * device's cache, and there is no guarantee they describe the same brief — the
 * other device may have regenerated since. Reassembling and comparing is exact,
 * costs a string compare, and fails closed to the flat document.
 */
export function sectionsMatchContent(sections: MarkdownBlock[], content: string): boolean {
  if (sections.length === 0) return false;
  return assembleBrief(sections) === content;
}
