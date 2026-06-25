import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { retrieveFromDirectory } from "@/lib/ai/rag";
import { webAnswerOnce, plainAnswerOnce } from "@/lib/ai/web-answer";
import { DEFAULT_CHAT_MODEL } from "@/lib/ai/models";
import { createNoteAction } from "@/app/(app)/directory/actions";
import { awardXp } from "@/lib/gamify/award";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SYSTEM = `You are a curriculum designer building a structured learning path.

Organize the path into three markdown sections:
## Prerequisites
## Core Concepts
## Advanced Applications

For each, list concrete subtopics, each with a one-line description.
- When an existing library item fits a subtopic, link it inline using
  [[Exact Title]] copied VERBATIM from the provided list (only those titles).
- Where the library has no coverage, append "(gap)" so the user knows to
  research it.
Keep it skimmable. Output clean markdown only — no preamble.`;

/**
 * Topic deep-dive / curriculum generator. Maps existing Directory items into a
 * Prereqs→Core→Advanced path via [[wikilinks]], fills gaps (web when enabled),
 * and saves the result as a living note. One AI call (+ one vector search).
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

  try {
    // Existing items to weave into the path as [[wikilinks]].
    const related = await retrieveFromDirectory(user.id, topic, 15);
    const seen = new Set<string>();
    const linkList = related
      .map((r) => r.title)
      .filter((t) => (seen.has(t) ? false : (seen.add(t), true)))
      .map((t) => `[[${t}]]`)
      .join("\n");

    const userContent = `Topic: ${topic}\n\nExisting library items you may link with [[Exact Title]] (use these titles verbatim, only when relevant):\n${linkList || "(none yet)"}`;

    let text = "";
    let sources: { title: string; url: string }[] = [];
    try {
      const r = await webAnswerOnce({ model: DEFAULT_CHAT_MODEL, system: SYSTEM, userContent });
      text = r.text;
      sources = r.sources;
    } catch {
      const r = await plainAnswerOnce({ model: DEFAULT_CHAT_MODEL, system: SYSTEM, userContent });
      text = r.text;
    }
    if (!text.trim()) return NextResponse.json({ error: "No content generated" }, { status: 502 });

    const sourcesBlock =
      sources.length > 0
        ? `\n\n## Further reading\n${sources.map((s) => `- [${s.title}](${s.url})`).join("\n")}`
        : "";

    const r = await createNoteAction({
      title: `Curriculum: ${topic}`,
      content: `${text}${sourcesBlock}`,
      folderId,
    });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 500 });
    // Gamify: building a curriculum earns a bonus on top of note_created XP.
    await awardXp(user.id, { source: "curriculum", itemId: r.itemId, refKind: "curriculum", refId: r.itemId });
    return NextResponse.json({ ok: true, itemId: r.itemId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
