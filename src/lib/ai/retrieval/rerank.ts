import { generateObject } from "ai";
import { z } from "zod";
import { aiAvailable, fastModel } from "@/lib/ai/provider";
import type { RagSource } from "@/lib/ai/rag";

/** Merge candidate lists, dedupe by item id keeping the highest similarity. */
export function unionByItem(lists: RagSource[][]): RagSource[] {
  const byId = new Map<string, RagSource>();
  for (const list of lists) {
    for (const s of list) {
      const prev = byId.get(s.directoryItemId);
      if (!prev || s.similarity > prev.similarity) byId.set(s.directoryItemId, s);
    }
  }
  return Array.from(byId.values()).sort((a, b) => b.similarity - a.similarity);
}

/**
 * Reorder candidates by a model-provided relevance ranking. Indexes the model
 * lists (best → worst) come first; any candidate it dropped is appended in the
 * original order so nothing is lost. Pure — unit-tested.
 */
export function applyRanking(candidates: RagSource[], order: number[], keep: number): RagSource[] {
  const seen = new Set<number>();
  const out: RagSource[] = [];
  for (const i of order) {
    if (Number.isInteger(i) && i >= 0 && i < candidates.length && !seen.has(i)) {
      seen.add(i);
      out.push(candidates[i]);
    }
  }
  for (let i = 0; i < candidates.length; i++) if (!seen.has(i)) out.push(candidates[i]);
  return out.slice(0, keep);
}

const RankSchema = z.object({ order: z.array(z.number().int()).max(40) });

/**
 * Rerank the vector+keyword candidate union by how well each actually answers
 * the question, keeping the best `keep`. Vector similarity alone ranks by
 * topical closeness, not answer-relevance, so the strongest evidence didn't
 * always lead; a cheap fast-model rerank fixes the ordering.
 *
 * Runs on the base fast model (Haiku), fail-soft: on any error (or when there's
 * nothing to reorder) it falls back to the existing similarity order.
 */
export async function rerankSources(
  query: string,
  candidates: RagSource[],
  keep = 8,
): Promise<RagSource[]> {
  if (candidates.length <= keep || !aiAvailable()) return candidates.slice(0, keep);
  const pool = candidates.slice(0, 20); // bound the rerank prompt
  try {
    const list = pool
      .map((s, i) => `[${i}] (${s.kind}) ${s.title}\n${(s.snippet ?? "").slice(0, 200)}`)
      .join("\n\n");
    const { object } = await generateObject({
      model: fastModel(),
      schema: RankSchema,
      system: `You rerank candidate documents by how well each ANSWERS the user's question (not just topical similarity). Return "order": candidate indexes from MOST to LEAST relevant. Include only genuinely relevant candidates; omit ones that don't help.`,
      prompt: `Question: ${query}\n\nCandidates:\n${list}\n\nReturn the indexes in relevance order.`,
    });
    return applyRanking(pool, object.order, keep);
  } catch {
    return candidates.slice(0, keep);
  }
}
