import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { directoryFolders } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { fetchDirectoryPage } from "@/lib/directory/query";
import { detectGaps } from "@/lib/ai/analysis";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Knowledge-gap detector for a folder / tag cluster. Pulls up to 40 item
 * titles+previews (cheap, indexed) and asks Haiku once for the most important
 * missing subtopics. Opt-in.
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

  let body: { folder?: string | null; tagIds?: string[] };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const folder = body.folder ?? null;
  const tagIds = body.tagIds ?? [];

  try {
    const page = await fetchDirectoryPage(user.id, { folder, tagIds, offset: 0, limit: 40 });
    if (page.items.length === 0) return NextResponse.json({ gaps: [] });

    // Scope label for the prompt.
    let scopeName = "your library";
    if (folder && folder !== "unsorted") {
      const [f] = await db
        .select({ name: directoryFolders.name })
        .from(directoryFolders)
        .where(and(eq(directoryFolders.id, folder), eq(directoryFolders.userId, user.id)))
        .limit(1);
      if (f) scopeName = f.name;
    } else if (folder === "unsorted") {
      scopeName = "unsorted items";
    } else if (tagIds.length > 0) {
      scopeName = "the selected tags";
    }

    const gaps = await detectGaps(
      scopeName,
      page.items.map((i) => ({ title: i.title, preview: i.preview ?? "" })),
    );
    return NextResponse.json({ gaps, scope: scopeName });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ gaps: [], error: message }, { status: 500 });
  }
}
