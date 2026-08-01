import { generateObject } from "ai";
import { z } from "zod";
import { aiAvailable, activeProvider } from "./provider";
import { userModelChoice, userSmartModel } from "./user-model";
import { conceptName, isValidConceptName } from "@/lib/thinktank/concept-slug";

/**
 * The Explore card: one concept, always the same four parts.
 *
 * ## Why the format is fixed
 *
 * A deck card is freeform markdown, which lets the model choose a shape per
 * card — sometimes a definition, sometimes a story, sometimes a list. That
 * variety is fine when you read a deck front to back. It is actively bad when
 * you are chaining through twenty concepts in ten minutes, because every card
 * costs you a moment of re-orientation before you can read it.
 *
 * So the shape never varies: what it is → why it matters → a real example →
 * where to go next. The consistency IS the feature.
 *
 * ## Why the caps are in the schema
 *
 * "Under two minutes" is a promise about length, and a prompt asking politely
 * for brevity does not keep it. The character ceilings below are the actual
 * mechanism — a model that runs long fails validation rather than shipping a
 * wall of text into a format whose whole point is that it is skimmable.
 *
 * ## Why one call returns everything
 *
 * Related concepts and the check questions come back with the card. Generating
 * them separately would triple the per-concept cost for no quality gain, and
 * per-concept cost is the constraint that decides whether endless exploration
 * is affordable at all.
 */

export type GeneratedConcept = {
  name: string;
  whatIsIt: string;
  whyItMatters: string;
  realWorldExample: string;
  related: { name: string }[];
  questions: { question: string; answer: string }[];
  model: string;
  tokenCount: number | null;
};

/**
 * Length ceilings, in characters.
 *
 * Sized so all three parts together read in well under a minute: roughly 45
 * words each at ~5.5 chars/word. Raising these is the fastest way to lose the
 * feel of the mode, so they live here with their reasoning rather than being
 * scattered through a prompt.
 */
const MAX_WHAT = 260;
const MAX_WHY = 260;
const MAX_EXAMPLE = 260;

const ConceptSchema = z.object({
  whatIsIt: z.string().min(20).max(MAX_WHAT),
  whyItMatters: z.string().min(20).max(MAX_WHY),
  realWorldExample: z.string().min(10).max(MAX_EXAMPLE),
  related: z
    .array(z.object({ name: z.string().min(2).max(80) }))
    .min(2)
    .max(6),
  questions: z
    .array(
      z.object({
        question: z.string().min(8).max(200),
        answer: z.string().min(2).max(300),
      }),
    )
    .min(1)
    .max(2),
});

/**
 * Write one concept card.
 *
 * `context` is the user's own material (library titles) plus the topic they
 * are exploring under, so a concept met while reading about Cybersecurity is
 * explained as a security idea rather than in the abstract.
 *
 * Returns null on any failure — the caller marks the concept `error` and the
 * user gets a retry, which is strictly better than a half-populated card.
 */
export async function generateConceptCard(
  name: string,
  context: { topic?: string | null; libraryTitles?: string[]; cameFrom?: string | null } = {},
): Promise<GeneratedConcept | null> {
  if (!aiAvailable() && !process.env.ANTHROPIC_API_KEY) return null;
  if (!isValidConceptName(name)) return null;

  const choice = await userModelChoice();
  const modelId =
    choice?.id ??
    (activeProvider() === "openrouter"
      ? (process.env.OPENROUTER_SMART_MODEL ?? "deepseek/deepseek-v4-flash-0731")
      : "claude-sonnet-4-6");

  const library = (context.libraryTitles ?? []).slice(0, 8);

  try {
    const result = await generateObject({
      model: await userSmartModel(),
      schema: ConceptSchema,
      // A whole card is a few hundred tokens. This ceiling is what keeps the
      // request short enough to finish inside a serverless function's window —
      // the reason Explore can generate inline while decks have to be stepped.
      maxTokens: 900,
      system: `You write single-concept micro-learning cards. Every card has exactly four parts and the format NEVER varies — a reader chains through many of these, and the consistency is what makes them fast to read.

- whatIsIt: what the thing actually is, in 1-2 plain sentences. Define it, don't preamble. Assume an intelligent adult who has simply never met this term.
- whyItMatters: 1-2 sentences on the consequence — what breaks without it, what it enables, why anyone cares. Not a restatement of the definition.
- realWorldExample: ONE concrete, named instance. A real system, a real incident, a real number. "Banking phishing sites" beats "attackers may misuse it".
- related: 3-5 genuinely adjacent concepts a curious reader would want next. Real, nameable concepts — not chapter headings, not the topic itself, not this concept reworded. These are how the reader keeps exploring, so make them tempting and specific.
- questions: 1-2 short questions that check understanding of THIS card, each with a one-line answer. Not trivia — the question a good teacher asks to see if it landed.

Hard rules:
- Be brief. Each of the three prose parts must be under ${MAX_WHAT} characters. Going long fails.
- Concrete over abstract, always. A number, a name or a date beats an adjective.
- If you are not confident the concept is real, say what it most likely refers to rather than inventing detail.`,
      prompt: [
        `Concept: ${name}`,
        context.topic ? `The reader is exploring the topic: ${context.topic}. Frame the card for that context.` : null,
        context.cameFrom ? `They arrived here from: ${context.cameFrom}. Don't repeat what that card would have covered.` : null,
        library.length > 0
          ? `Things already in their library (for tone and level, not to cite):\n${library.map((t) => `- ${t}`).join("\n")}`
          : null,
      ]
        .filter(Boolean)
        .join("\n\n"),
    });

    const usage = result.usage;
    return {
      name: conceptName(name),
      ...result.object,
      // Drop related entries that aren't usable concepts, and any that are just
      // this card again — a self-link is a dead end in an exploration graph.
      related: result.object.related
        .filter((r) => isValidConceptName(r.name))
        .filter((r) => r.name.trim().toLowerCase() !== name.trim().toLowerCase()),
      model: modelId,
      tokenCount: usage?.totalTokens ?? null,
    };
  } catch (err) {
    console.warn("generateConceptCard failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

// ── Discover ───────────────────────────────────────────────────────────

export type DiscoveredConcepts = {
  known: { name: string; why: string }[];
  unknown: { name: string; why: string }[];
  model: string;
  tokenCount: number | null;
};

const DiscoverSchema = z.object({
  known: z.array(z.object({ name: z.string().min(2).max(80), why: z.string().max(160) })).max(8),
  unknown: z.array(z.object({ name: z.string().min(2).max(80), why: z.string().max(160) })).min(3).max(10),
});

/**
 * Split a topic into what this reader has probably already met and what they
 * probably haven't.
 *
 * The evidence is their own material: titles from their library that are
 * semantically near the topic, the skills they've built up, and concepts they
 * have already opened in Explore. That is what makes the "you may not know"
 * list feel like it is about them rather than a generic syllabus.
 *
 * The split is explicitly a GUESS, and the UI presents it as one — a reader
 * told they already know something they don't is worse served than one who was
 * told nothing.
 */
export async function discoverConcepts(
  topic: string,
  evidence: { libraryTitles?: string[]; skills?: string[]; alreadySeen?: string[] } = {},
): Promise<DiscoveredConcepts | null> {
  if (!aiAvailable() && !process.env.ANTHROPIC_API_KEY) return null;

  const choice = await userModelChoice();
  const modelId =
    choice?.id ??
    (activeProvider() === "openrouter"
      ? (process.env.OPENROUTER_SMART_MODEL ?? "deepseek/deepseek-v4-flash-0731")
      : "claude-sonnet-4-6");

  const library = (evidence.libraryTitles ?? []).slice(0, 25);
  const skills = (evidence.skills ?? []).slice(0, 15);
  const seen = (evidence.alreadySeen ?? []).slice(0, 40);

  try {
    const result = await generateObject({
      model: await userSmartModel(),
      schema: DiscoverSchema,
      maxTokens: 1_200,
      system: `You map what someone does and doesn't yet know about a topic, so they can see their blind spots.

Given a topic and evidence about the reader, return two lists:
- known: concepts within this topic they have very likely already met, based on the evidence. Only include one when the evidence genuinely supports it — an empty list is a fine answer for someone new to the topic. Max 6.
- unknown: 5-8 concepts within this topic that are genuinely important and that the evidence does NOT suggest they know. These are the payoff: they should make the reader think "I've never heard of that, and I probably should have."

Rules for "unknown":
- Real, nameable concepts a practitioner would recognise — specific things like "Kerberos", "YARA rules", "MITRE ATT&CK", not vague areas like "advanced topics" or "best practices".
- Order by how much knowing it would change their understanding.
- Spread across the topic — don't return five variations of one idea.
- Never list something that appears in the evidence.
- "why" is at most one short sentence on why it's worth knowing.`,
      prompt: [
        `Topic: ${topic}`,
        library.length > 0 ? `In their library:\n${library.map((t) => `- ${t}`).join("\n")}` : "Their library has nothing close to this topic.",
        skills.length > 0 ? `Skills they've been building: ${skills.join(", ")}` : null,
        seen.length > 0 ? `Concepts they have already read in this app: ${seen.join(", ")}` : null,
      ]
        .filter(Boolean)
        .join("\n\n"),
    });

    const usage = result.usage;
    return {
      known: result.object.known.filter((c) => isValidConceptName(c.name)),
      unknown: result.object.unknown.filter((c) => isValidConceptName(c.name)),
      model: modelId,
      tokenCount: usage?.totalTokens ?? null,
    };
  } catch (err) {
    console.warn("discoverConcepts failed:", err instanceof Error ? err.message : err);
    return null;
  }
}
