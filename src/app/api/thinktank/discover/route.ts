import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { aiAvailable } from "@/lib/ai/provider";
import { checkRateLimit } from "@/lib/rate-limit";
import { checkAiBudget, budgetExceededMessage, recordAiUsage } from "@/lib/ai/budget";
import { discoverConcepts } from "@/lib/ai/concept";
import { retrieveFromDirectory } from "@/lib/ai/rag";
import { conceptsSeenForTopic, userSkillNames } from "@/lib/thinktank/concepts";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * "Show me what I don't know" for a topic.
 *
 * The evidence is the user's OWN material — library items semantically near the
 * topic, the skills they've been building, and concepts they've already opened
 * in Explore. That is what separates this from a generic syllabus: the list is
 * about them, and it gets better the more they use the app.
 *
 * The split is a guess and the UI says so. Being told you already know
 * something you don't is worse than being told nothing, which is why every
 * "may not know" entry is correctable with one tap.
 */
export async function POST(req: Request) {
  let user;
  try {
    ({ user } = await requireUser());
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!aiAvailable() && !process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "AI isn't configured" }, { status: 503 });
  }

  let body: { topic?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const topic = (body.topic ?? "").trim();
  if (topic.length < 2) return NextResponse.json({ error: "topic required" }, { status: 400 });

  const rl = await checkRateLimit(user.id, "thinktank-discover", 20, 60);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many topics at once — try again shortly" }, { status: 429 });
  }
  const budget = await checkAiBudget(user.id);
  if (!budget.allowed) {
    return NextResponse.json({ error: budgetExceededMessage(budget) }, { status: 429 });
  }

  // Every evidence source is independently fail-soft: an empty library or a
  // missing embeddings key degrades the personalisation, it doesn't break the
  // feature. A brand-new user still gets a useful "may not know" list.
  const [library, skills, seen] = await Promise.all([
    retrieveFromDirectory(user.id, topic, 25)
      .then((hits) => hits.map((h) => h.title))
      .catch(() => [] as string[]),
    userSkillNames(user.id),
    conceptsSeenForTopic(user.id, topic),
  ]);

  const result = await discoverConcepts(topic, {
    libraryTitles: library,
    skills,
    alreadySeen: seen,
  });
  if (!result) {
    return NextResponse.json({ error: "Couldn't map this topic — try again" }, { status: 502 });
  }

  if (result.tokenCount) void recordAiUsage(user.id, result.tokenCount);

  return NextResponse.json({
    ok: true,
    topic,
    known: result.known,
    unknown: result.unknown,
    /** Whether the "you know" list is based on anything real. */
    grounded: library.length > 0 || skills.length > 0 || seen.length > 0,
  });
}
