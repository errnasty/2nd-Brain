import { generateObject } from "ai";
import { z } from "zod";
import { aiAvailable, fastModel } from "@/lib/ai/provider";

const RewriteSchema = z.object({
  standalone: z.string().min(1).max(400),
  expansions: z.array(z.string().min(1).max(200)).max(2).default([]),
});

export type RewrittenQuery = { queries: string[] };

/**
 * Rewrite a conversational question into standalone search queries.
 *
 * The retrieval query used to be the raw latest message, so a follow-up like
 * "what about the second one?" embedded a pronoun-laden fragment and retrieved
 * poorly. This resolves those references against the recent conversation into a
 * self-contained, keyword-rich query, and optionally fans out 1–2 sub-queries
 * for genuinely multi-part questions.
 *
 * Runs on the base fast model (Haiku), NOT the user's chosen model — it's a
 * cheap internal step. Fail-soft: returns the raw question on any error, and
 * skips the model entirely when there's no history to resolve against (a first
 * question is already standalone).
 */
export async function rewriteQuery(
  question: string,
  history: { role: "user" | "assistant"; content: string }[],
): Promise<RewrittenQuery> {
  const raw: RewrittenQuery = { queries: [question] };
  if (!aiAvailable() || history.length === 0) return raw;
  try {
    const convo = history
      .slice(-6)
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content.slice(0, 500)}`)
      .join("\n");
    const { object } = await generateObject({
      model: fastModel(),
      schema: RewriteSchema,
      system: `Rewrite the user's latest message into a standalone search query for a vector database over their personal notes, articles, and documents.
- Resolve pronouns and references ("it", "the second one", "that article") using the conversation.
- Keep it concise and keyword-rich; drop chit-chat and question phrasing.
- expansions: 0–2 additional sub-queries ONLY when the question clearly has distinct parts worth searching separately. Usually leave empty.`,
      prompt: `Conversation so far:\n${convo}\n\nLatest message: ${question}\n\nStandalone search query:`,
    });
    const queries = [object.standalone.trim(), ...object.expansions.map((e) => e.trim())].filter(Boolean);
    return { queries: queries.length > 0 ? queries : [question] };
  } catch {
    return raw;
  }
}
