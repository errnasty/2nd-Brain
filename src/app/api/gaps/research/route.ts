import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { webAnswerOnce, plainAnswerOnce } from "@/lib/ai/web-answer";
import { DEFAULT_CHAT_MODEL } from "@/lib/ai/models";
import { createNoteAction } from "@/app/(app)/directory/actions";
import { awardXp } from "@/lib/gamify/award";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SYSTEM = `You research a topic to fill a gap in the user's personal knowledge base.
Write a concise markdown briefing: a short overview, the key points as bullets,
and a few open questions to explore further. Use web search for current/factual
detail and cite as you go. Keep it tight and skimmable.`;

/**
 * Research a knowledge gap via web search and save the result as a new note in
 * the Directory (the ground-truth store). One Anthropic call.
 */
export async function POST(req: Request) {
  let user;
  try {
    ({ user } = await requireUser());
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = await checkRateLimit(user.id, "analyze", 20, 60);
  if (!rl.allowed) return NextResponse.json({ error: "Rate limited" }, { status: 429 });

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 503 });
  }

  let body: { topic?: string; folderId?: string | null };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const topic = (body.topic ?? "").trim();
  if (!topic) return NextResponse.json({ error: "topic required" }, { status: 400 });

  const folderId = body.folderId && UUID_RE.test(body.folderId) ? body.folderId : null;

  const userContent = `Topic to research for my knowledge base: ${topic}`;
  try {
    // Try web search first; if the web_search tool isn't enabled on the org (or
    // any web error), fall back to a plain completion so a note is still saved.
    let text = "";
    let sources: { title: string; url: string }[] = [];
    try {
      const r = await webAnswerOnce({ model: DEFAULT_CHAT_MODEL, system: SYSTEM, userContent });
      text = r.text;
      sources = r.sources;
    } catch (webErr) {
      console.warn(
        "gaps/research web search failed, falling back to no-web:",
        webErr instanceof Error ? webErr.message : webErr,
      );
      const r = await plainAnswerOnce({ model: DEFAULT_CHAT_MODEL, system: SYSTEM, userContent });
      text = r.text;
    }
    if (!text.trim()) return NextResponse.json({ error: "No content generated" }, { status: 502 });

    const sourcesBlock =
      sources.length > 0
        ? `\n\n## Sources\n${sources.map((s) => `- [${s.title}](${s.url})`).join("\n")}`
        : "";
    const content = `${text}${sourcesBlock}`;

    const r = await createNoteAction({ title: `Research: ${topic}`, content, folderId });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 500 });
    // Gamify: deep research earns a bonus on top of the note_created XP.
    await awardXp(user.id, { source: "research", itemId: r.itemId, refKind: "research", refId: r.itemId });
    return NextResponse.json({ ok: true, itemId: r.itemId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
