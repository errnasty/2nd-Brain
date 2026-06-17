import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { retrieveFromDirectory } from "@/lib/ai/rag";
import { classifyConnections } from "@/lib/ai/analysis";
import { getDirectoryItemStudyText } from "@/lib/directory/item-text";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Implicit connections + tensions for one Directory item. Indexed pgvector
 * search finds the nearest other items; a single Haiku call labels each as a
 * supporting connection or a contradicting tension. Opt-in (called on demand).
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

  let itemId: string | undefined;
  try {
    ({ itemId } = (await req.json()) as { itemId?: string });
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  if (!itemId) return NextResponse.json({ error: "itemId required" }, { status: 400 });

  // Resolve the authoritative text by kind — saved articles carry NO
  // directory_items.content and documents only a truncated preview, so building
  // the query from content directly searched on the title alone for articles.
  const resolved = await getDirectoryItemStudyText(user.id, itemId);
  if (!resolved) return NextResponse.json({ error: "Item not found" }, { status: 404 });

  const snippet = resolved.text.slice(0, 1500);
  const query = `${resolved.title}\n\n${snippet}`.trim();

  try {
    const candidates = (await retrieveFromDirectory(user.id, query, 8))
      .filter((c) => c.directoryItemId !== itemId && c.similarity > 0.3)
      .slice(0, 6);

    if (candidates.length === 0) return NextResponse.json({ items: [] });

    const classified = await classifyConnections(
      { title: resolved.title, snippet },
      candidates.map((c) => ({ title: c.title, snippet: c.snippet })),
    );

    const items = classified
      .filter((r) => r.index >= 0 && r.index < candidates.length)
      .map((r) => {
        const c = candidates[r.index];
        return {
          itemId: c.directoryItemId,
          title: c.title,
          kind: c.kind,
          similarity: c.similarity,
          relation: r.relation,
          reason: r.reason,
        };
      });

    return NextResponse.json({ items });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ items: [], error: message }, { status: 500 });
  }
}
