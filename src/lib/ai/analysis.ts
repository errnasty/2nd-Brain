import { generateObject } from "ai";
import { z } from "zod";
import { aiAvailable, fastModel } from "./provider";

// Phase 2 semantic analysis. Each function is ONE structured fast-model call
// with capped inputs — vector search (the expensive-at-scale part) happens in
// the caller via the indexed pgvector query. Returns [] on any failure so the
// UI degrades quietly.

export type Relation = "connection" | "tension";

const ConnSchema = z.object({
  results: z.array(
    z.object({
      index: z.number().int(),
      relation: z.enum(["connection", "tension"]),
      reason: z.string().max(240),
    }),
  ),
});

export type ClassifiedConnection = { index: number; relation: Relation; reason: string };

/**
 * Classify how each candidate relates to the source item: a "connection"
 * (supports / overlaps / extends) or a "tension" (contradicts / competing
 * view). Candidates are pre-filtered nearest-neighbours, so this is cheap.
 */
export async function classifyConnections(
  source: { title: string; snippet: string },
  candidates: { title: string; snippet: string }[],
): Promise<ClassifiedConnection[]> {
  if (!aiAvailable() || candidates.length === 0) return [];

  const list = candidates
    .map((c, i) => `[${i}] ${c.title}\n${c.snippet.slice(0, 400)}`)
    .join("\n\n");

  try {
    const { object } = await generateObject({
      model: fastModel(),
      schema: ConnSchema,
      system: `You compare a SOURCE note against CANDIDATE notes from the same personal knowledge base.

For each candidate, decide its relation to the source:
- "connection": it supports, overlaps with, or extends the source's ideas.
- "tension": it disagrees, contradicts, or offers a competing/opposing view.

Give a specific one-sentence reason naming the actual point of overlap or conflict. Only include candidates with a genuine, substantive relation — skip weak/coincidental matches by omitting their index.`,
      prompt: `SOURCE: ${source.title}\n${source.snippet.slice(0, 1500)}\n\nCANDIDATES:\n${list}`,
    });
    return object.results;
  } catch (err) {
    console.warn("classifyConnections failed:", err instanceof Error ? err.message : err);
    return [];
  }
}

const GapSchema = z.object({
  gaps: z
    .array(
      z.object({
        topic: z.string().max(80),
        why: z.string().max(240),
      }),
    )
    .max(6),
});

export type KnowledgeGap = { topic: string; why: string };

/**
 * Given the titles + previews of a folder/tag cluster, name the most important
 * missing subtopics or counter-perspectives. One Haiku call.
 */
export async function detectGaps(
  scopeName: string,
  items: { title: string; preview: string }[],
): Promise<KnowledgeGap[]> {
  if (!aiAvailable() || items.length === 0) return [];

  const list = items
    .slice(0, 40)
    .map((it) => `- ${it.title}: ${it.preview.slice(0, 160)}`)
    .join("\n");

  try {
    const { object } = await generateObject({
      model: fastModel(),
      schema: GapSchema,
      system: `You audit a cluster of notes/articles in someone's knowledge base and identify GAPS — important subtopics, prerequisites, or counter-perspectives that are missing given what's already there.

Rules:
- 3-6 gaps, most important first.
- Each "topic" is a short phrase (what's missing). Each "why" is one sentence explaining why it matters given the existing collection.
- Be specific to THIS collection (e.g. "security vulnerabilities of Framework X"), not generic advice.
- Don't list things the collection already covers.`,
      prompt: `Collection: ${scopeName}\n\nExisting items:\n${list}`,
    });
    return object.gaps;
  } catch (err) {
    console.warn("detectGaps failed:", err instanceof Error ? err.message : err);
    return [];
  }
}
