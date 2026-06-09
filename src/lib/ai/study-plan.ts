import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";

const HAIKU = "claude-haiku-4-5-20251001";

// One study session / task. `dayOffset` is days from the start date — the
// SERVER turns it into a real due date, because models are unreliable at
// calendar arithmetic. `link` must be a verbatim title from the provided list
// (or omitted); `gap` flags a topic with no existing material.
const SessionSchema = z.object({
  topic: z.string().min(2).max(160),
  focus: z.string().min(2).max(280),
  dayOffset: z.number().int().min(0).max(400),
  durationMin: z.number().int().min(10).max(240),
  review: z.boolean(),
  link: z.string().max(200).optional(),
  gap: z.boolean(),
});

const StudyPlanSchema = z.object({
  title: z.string().min(3).max(120),
  summary: z.string().min(10).max(600),
  sessions: z.array(SessionSchema).min(3).max(40),
  milestones: z
    .array(z.object({ label: z.string().min(2).max(160), dayOffset: z.number().int().min(0).max(400) }))
    .max(10)
    .optional(),
});

export type StudyPlan = z.infer<typeof StudyPlanSchema>;

/**
 * Generate a realistic, dated study plan from a goal. The model owns the
 * pedagogy (topics, ordering, durations, where review fits); the server owns
 * the calendar math (turning dayOffset into due dates). Returns null on failure
 * so the caller can degrade gracefully.
 */
export async function generateStudyPlan(input: {
  goal: string;
  totalDays: number;
  hoursPerWeek: number;
  deadlineISO: string | null;
  contextTitles: string[];
}): Promise<StudyPlan | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const goal = input.goal.trim();
  if (!goal) return null;

  const linkList =
    input.contextTitles.length > 0
      ? input.contextTitles.map((t) => `- ${t}`).join("\n")
      : "(none yet)";
  const deadlineLine = input.deadlineISO
    ? `Hard deadline: day ${input.totalDays} (the last day). Everything must finish by then, with review before it.`
    : `No hard deadline — plan across about ${input.totalDays} days.`;

  try {
    const { object } = await generateObject({
      model: anthropic(HAIKU),
      schema: StudyPlanSchema,
      system: `You are an expert learning coach. Design a realistic, followable study plan the user can actually keep up with.

Constraints:
- Budget ≈ ${input.hoursPerWeek} hours per week. Keep the SUM of durationMin within any rolling 7-day window close to that — do not overload.
- Spread sessions across the available time using "dayOffset" (whole days from the start). ${deadlineLine}
- Order topics so prerequisites come first; build up gradually.
- Insert spaced REVIEW/recap sessions (set "review": true) at intervals and especially in the days before the deadline — reinforce, don't just cover new material.
- For each session give a specific, actionable "focus" (what to do/produce), not a vague restatement of the topic.
- If an existing library item fits a session, set "link" to its title copied VERBATIM from the list below (only those titles). Otherwise set "gap": true when the user has no material for it.
- Never invent library titles. Keep it achievable — fewer, well-paced sessions beat an overwhelming list.`,
      prompt: `Goal: ${goal}

Available existing library items (use the exact title in "link" when relevant):
${linkList}`,
    });
    return object;
  } catch (err) {
    console.warn("generateStudyPlan failed:", err instanceof Error ? err.message : err);
    return null;
  }
}
