import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import type { LanguageModelV1 } from "ai";
import { z } from "zod";
import { aiAvailable, fastModel, smartModel } from "./provider";

// Cloud (Netlify) must finish inside the ~10s serverless limit → fast model,
// bounded output. The desktop app runs the server locally with no such limit,
// so it uses a stronger model + a bigger budget for a more detailed plan.
// STUDY_PLAN_MODEL still force-overrides with a specific Anthropic model id.
const isDesktop = process.env.APP_RUNTIME === "desktop";
const MAX_OUTPUT_TOKENS = isDesktop ? 8000 : 3500;

function planModel(): LanguageModelV1 {
  if (process.env.STUDY_PLAN_MODEL) return anthropic(process.env.STUDY_PLAN_MODEL);
  return isDesktop ? smartModel() : fastModel();
}

// One study session / task. `dayOffset` is days from the start date — the
// SERVER turns it into a real due date (models are unreliable at calendar
// arithmetic). Optional flags default to false so the model omitting them never
// fails validation. `link` is a verbatim title from the provided list.
const SessionSchema = z.object({
  topic: z.string().min(1).max(200),
  focus: z.string().max(400).optional().default(""),
  dayOffset: z.number().int().min(0).max(500),
  durationMin: z.number().int().min(5).max(360).optional().default(60),
  review: z.boolean().optional().default(false),
  link: z.string().max(200).optional(),
  gap: z.boolean().optional().default(false),
});

const StudyPlanSchema = z.object({
  title: z.string().min(1).max(200),
  summary: z.string().max(1000).optional().default(""),
  sessions: z.array(SessionSchema).min(1).max(60),
  milestones: z
    .array(z.object({ label: z.string().min(1).max(200), dayOffset: z.number().int().min(0).max(500) }))
    .max(20)
    .optional(),
});

export type StudyPlan = z.infer<typeof StudyPlanSchema>;

/**
 * Generate a realistic, dated study plan from a goal. The model owns the
 * pedagogy (topics, ordering, durations, where review fits); the server owns
 * the calendar math (turning dayOffset into due dates). Throws on failure so
 * the API surfaces a specific error instead of a generic "couldn't generate".
 */
export async function generateStudyPlan(input: {
  goal: string;
  totalDays: number;
  hoursPerWeek: number;
  deadlineISO: string | null;
  contextTitles: string[];
}): Promise<StudyPlan> {
  if (!aiAvailable()) throw new Error("No AI provider configured (set ANTHROPIC_API_KEY or OPENROUTER_API_KEY)");
  const goal = input.goal.trim();
  if (!goal) throw new Error("Study goal is empty");

  const linkList =
    input.contextTitles.length > 0
      ? input.contextTitles.map((t) => `- ${t}`).join("\n")
      : "(none yet)";
  const deadlineLine = input.deadlineISO
    ? `Hard deadline: day ${input.totalDays} (the last day). Everything must finish by then, with review before it.`
    : `No hard deadline — plan across about ${input.totalDays} days.`;

  const detailLine = isDesktop
    ? `Be thorough and specific — break each topic into concrete sub-skills with detailed, actionable focuses. Use as many sessions as the plan genuinely needs (up to ~50).`
    : `Be concise — aim for the FEWEST sessions that cover everything (roughly 2-4 sessions per topic; keep the total well under 50). This must generate quickly.`;

  const system = `You are an expert learning coach. Design a realistic, followable study plan that covers EVERY topic the user lists.

${detailLine}

Constraints:
- Budget ≈ ${input.hoursPerWeek} hours per week. Keep the SUM of durationMin within any rolling 7-day window close to that — do not overload.
- Spread sessions across the available time using "dayOffset" (whole days from the start, 0 = day one). ${deadlineLine}
- Order topics so prerequisites come first; build up gradually.
- Insert a few spaced REVIEW sessions ("review": true), especially before the deadline.
- Give each session a short, specific "focus" (what to do/produce).
- If an existing library item fits, set "link" to its EXACT title from the list below; otherwise set "gap": true. Never invent library titles.`;

  const prompt = `Goal: ${goal}

Available existing library items (use the exact title in "link" when relevant):
${linkList}`;

  const { object } = await generateObject({
    model: planModel(),
    schema: StudyPlanSchema,
    system,
    prompt,
    maxTokens: MAX_OUTPUT_TOKENS,
  });
  return object;
}
