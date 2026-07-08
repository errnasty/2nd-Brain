// Rabbithole lens presets + small pure helpers. Plain data so both the client
// (selection popover chips) and the server route can import it without pulling
// server-only deps — same pattern as lib/ai/models.ts.

export type RabbitholeLens = "explain" | "eli5" | "example" | "deeper";

export const RABBITHOLE_LENSES: { key: RabbitholeLens; label: string; prompt: string }[] = [
  {
    key: "explain",
    label: "Explain",
    prompt:
      "Explain this passage clearly and precisely. Define the key terms and unpack what it is really saying.",
  },
  {
    key: "eli5",
    label: "ELI5",
    prompt:
      "Explain this passage like I'm five — simple words, everyday analogies, no jargon.",
  },
  {
    key: "example",
    label: "Example",
    prompt:
      "Give two or three concrete, worked examples that make this passage tangible.",
  },
  {
    key: "deeper",
    label: "Go Deeper",
    prompt:
      "Go deeper on this passage: the underlying mechanisms, nuances, edge cases, and implications the text glosses over.",
  },
];

export function getLens(key: string | null | undefined) {
  return RABBITHOLE_LENSES.find((l) => l.key === key) ?? null;
}

/**
 * Node title from a streamed markdown answer: the first ATX heading if the
 * model followed instructions, else the first non-empty line. Clamped so a
 * runaway first paragraph can't become a breadcrumb label.
 */
export function extractNodeTitle(markdown: string, fallback: string): string {
  for (const raw of markdown.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const heading = /^#{1,6}\s+(.+)$/.exec(line);
    const candidate = (heading ? heading[1] : line).replace(/[*_`#]/g, "").trim();
    if (candidate) return candidate.length > 80 ? `${candidate.slice(0, 77)}…` : candidate;
  }
  const fb = fallback.trim() || "Untitled branch";
  return fb.length > 80 ? `${fb.slice(0, 77)}…` : fb;
}

/**
 * Ids of `rootId` plus every descendant, walking parent_id links in app code
 * (parent_id carries no FK, so the DB can't cascade the subtree for us).
 */
export function collectSubtreeIds(
  nodes: { id: string; parentId: string | null }[],
  rootId: string,
): string[] {
  const childrenOf = new Map<string, string[]>();
  for (const n of nodes) {
    if (!n.parentId) continue;
    const list = childrenOf.get(n.parentId) ?? [];
    list.push(n.id);
    childrenOf.set(n.parentId, list);
  }
  const out: string[] = [];
  const queue = [rootId];
  const seen = new Set<string>();
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue; // cycle guard — corrupt data must not hang the request
    seen.add(id);
    out.push(id);
    queue.push(...(childrenOf.get(id) ?? []));
  }
  return out;
}
