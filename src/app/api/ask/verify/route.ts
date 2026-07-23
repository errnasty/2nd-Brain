import { generateObject } from "ai";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { aiAvailable, fastModel } from "@/lib/ai/provider";
import { fetchItemContents } from "@/lib/ai/rag";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Faithfulness check: does the answer stay supported by the cited library
 * sources? Opt-in (the client's Verify toggle). Re-fetches the cited items'
 * text server-side (never trusts client-supplied source text) and asks the
 * base fast model to flag claims the sources don't back. Fail-soft — a check
 * that can't run just returns "unknown".
 */
const VerdictSchema = z.object({
  verdict: z.enum(["supported", "partial", "unsupported"]),
  issues: z.array(z.string().min(1).max(300)).max(5).default([]),
});

export async function POST(req: Request) {
  let auth;
  try {
    auth = await requireUser();
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }
  const userId = auth.user.id;

  const rl = await checkRateLimit(userId, "ask-verify", 30, 60);
  if (!rl.allowed) return Response.json({ verdict: "unknown", issues: [] });
  if (!aiAvailable()) return Response.json({ verdict: "unknown", issues: [] });

  let body: { answer?: string; sourceIds?: string[] };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }
  const answer = (body.answer ?? "").trim();
  const sourceIds = Array.isArray(body.sourceIds)
    ? body.sourceIds.filter((s) => typeof s === "string").slice(0, 8)
    : [];
  if (!answer || sourceIds.length === 0) {
    // Nothing cited to verify against — can't judge faithfulness.
    return Response.json({ verdict: "unknown", issues: [] });
  }

  try {
    const contents = await fetchItemContents(userId, sourceIds);
    if (contents.length === 0) return Response.json({ verdict: "unknown", issues: [] });
    const sourceText = contents
      .map((c, i) => `[${i + 1}] ${c.title}\n${c.content.slice(0, 2500)}`)
      .join("\n\n");

    const { object } = await generateObject({
      model: fastModel(),
      schema: VerdictSchema,
      system: `You check whether an ANSWER is faithful to the SOURCES it cites.
- "supported": every substantive claim is backed by the sources.
- "partial": mostly supported but 1+ claims go beyond the sources.
- "unsupported": key claims are not backed by the sources.
- issues: short, specific descriptions of any claim not supported by the sources (empty when supported). Judge only against the provided sources; do not use outside knowledge.`,
      prompt: `SOURCES:\n${sourceText}\n\nANSWER:\n${answer.slice(0, 4000)}\n\nAssess faithfulness.`,
    });
    return Response.json(object);
  } catch {
    return Response.json({ verdict: "unknown", issues: [] });
  }
}
