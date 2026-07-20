import { generateObject } from "ai";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { checkAiBudget, recordAiUsage } from "@/lib/ai/budget";
import { aiAvailable } from "@/lib/ai/provider";
import { userFastModel } from "@/lib/ai/user-model";

export const runtime = "nodejs";
export const maxDuration = 30;
const Schema = z.object({ followups: z.array(z.string().min(1).max(120)).min(1).max(3) });

/**
 * #5 Suggested follow-ups. Given the last Q&A, return up to 3 short next
 * questions. Fail-soft: any error (no key, rate limit, model error) → empty
 * list so the UI just hides the chips. Cheap (Haiku) and non-blocking.
 */
export async function POST(req: Request) {
  let auth;
  try {
    auth = await requireUser();
  } catch {
    return Response.json({ followups: [] });
  }

  const rl = await checkRateLimit(auth.user.id, "ask-followups", 60, 60);
  if (!rl.allowed) return Response.json({ followups: [] });
  // Follow-up suggestions are decorative — over budget they just vanish.
  const budget = await checkAiBudget(auth.user.id);
  if (!budget.allowed) return Response.json({ followups: [] });
  if (!aiAvailable()) return Response.json({ followups: [] });

  let body: { question?: string; answer?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ followups: [] });
  }
  const question = (body.question ?? "").slice(0, 2000).trim();
  const answer = (body.answer ?? "").slice(0, 4000).trim();
  if (!question || !answer) return Response.json({ followups: [] });

  try {
    const { object, usage } = await generateObject({
      model: await userFastModel(),
      schema: Schema,
      system:
        "Given a question and its answer, propose up to 3 natural follow-up questions the user " +
        "might ask next. Each is short (under 12 words), specific to the content, and standalone. " +
        "No numbering, no preamble.",
      prompt: `QUESTION:\n${question}\n\nANSWER:\n${answer}`,
    });
    void recordAiUsage(auth.user.id, usage?.totalTokens ?? 0);
    return Response.json({ followups: object.followups.slice(0, 3) });
  } catch {
    return Response.json({ followups: [] });
  }
}
