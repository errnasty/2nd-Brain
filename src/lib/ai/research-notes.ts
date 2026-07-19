import { retrieveFromDirectory } from "@/lib/ai/rag";
import { webAnswerOnce, plainAnswerOnce, type WebSource } from "@/lib/ai/web-answer";
import { DEFAULT_CHAT_MODEL } from "@/lib/ai/models";
import { createNoteAction } from "@/app/(app)/directory/actions";
import { awardXp } from "@/lib/gamify/award";

export type NoteResult = { ok: true; itemId: string } | { ok: false; error: string };

const CURRICULUM_SYSTEM = `You are a curriculum designer building a structured learning path.

Organize the path into three markdown sections:
## Prerequisites
## Core Concepts
## Advanced Applications

For each, list concrete subtopics, each with a one-line description.
- When an existing library item fits a subtopic, link it inline using
  [[Exact Title]] copied VERBATIM from the provided list (only those titles).
- Where the library has no coverage, append "(gap)" so the user knows to
  research it.
Keep it skimmable. Output clean markdown only — no preamble.`;

const RESEARCH_SYSTEM = `You research a topic to fill a gap in the user's personal knowledge base.
Write a concise markdown briefing: a short overview, the key points as bullets,
and a few open questions to explore further. Use web search for current/factual
detail and cite as you go. Keep it tight and skimmable.`;

/** Web-first answer with plain-completion fallback (web tool may be disabled). */
async function answer(system: string, userContent: string): Promise<{ text: string; sources: WebSource[] }> {
  try {
    return await webAnswerOnce({ model: DEFAULT_CHAT_MODEL, system, userContent });
  } catch (webErr) {
    console.warn("web search failed, falling back to no-web:", webErr instanceof Error ? webErr.message : webErr);
    const r = await plainAnswerOnce({ model: DEFAULT_CHAT_MODEL, system, userContent });
    return { text: r.text, sources: [] };
  }
}

/**
 * Topic deep-dive / curriculum generator. Maps existing Directory items into a
 * Prereqs→Core→Advanced path via [[wikilinks]], fills gaps (web when enabled),
 * and saves the result as a living note. One AI call (+ one vector search).
 * Extracted from /api/curriculum so the background job runner shares it.
 */
export async function buildCurriculumNote(
  userId: string,
  topic: string,
  folderId: string | null,
): Promise<NoteResult> {
  // Existing items to weave into the path as [[wikilinks]] — fail-soft.
  let linkList = "";
  try {
    const related = await retrieveFromDirectory(userId, topic, 15);
    const seen = new Set<string>();
    linkList = related
      .map((r) => r.title)
      .filter((t) => (seen.has(t) ? false : (seen.add(t), true)))
      .map((t) => `[[${t}]]`)
      .join("\n");
  } catch {
    // no grounding — the path is still useful
  }

  const userContent = `Topic: ${topic}\n\nExisting library items you may link with [[Exact Title]] (use these titles verbatim, only when relevant):\n${linkList || "(none yet)"}`;
  const { text, sources } = await answer(CURRICULUM_SYSTEM, userContent);
  if (!text.trim()) return { ok: false, error: "No content generated" };

  const sourcesBlock =
    sources.length > 0
      ? `\n\n## Further reading\n${sources.map((s) => `- [${s.title}](${s.url})`).join("\n")}`
      : "";

  const r = await createNoteAction({ title: `Curriculum: ${topic}`, content: `${text}${sourcesBlock}`, folderId });
  if (!r.ok) return { ok: false, error: r.error };
  // Gamify bonus — fail-soft: XP must never fail a note that saved fine.
  try {
    await awardXp(userId, { source: "curriculum", itemId: r.itemId, refKind: "curriculum", refId: r.itemId });
  } catch {
    // ignore
  }
  return { ok: true, itemId: r.itemId };
}

/**
 * Research a knowledge gap via web search and save the result as a new note in
 * the Directory. Extracted from /api/gaps/research so the background job
 * runner shares it.
 */
export async function buildResearchNote(
  userId: string,
  topic: string,
  folderId: string | null,
): Promise<NoteResult> {
  const { text, sources } = await answer(RESEARCH_SYSTEM, `Topic to research for my knowledge base: ${topic}`);
  if (!text.trim()) return { ok: false, error: "No content generated" };

  const sourcesBlock =
    sources.length > 0 ? `\n\n## Sources\n${sources.map((s) => `- [${s.title}](${s.url})`).join("\n")}` : "";

  const r = await createNoteAction({ title: `Research: ${topic}`, content: `${text}${sourcesBlock}`, folderId });
  if (!r.ok) return { ok: false, error: r.error };
  try {
    await awardXp(userId, { source: "research", itemId: r.itemId, refKind: "research", refId: r.itemId });
  } catch {
    // ignore
  }
  return { ok: true, itemId: r.itemId };
}
