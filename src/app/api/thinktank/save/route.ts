import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { thinktankSaved } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { conceptSlug } from "@/lib/thinktank/concept-slug";
import { getConcept } from "@/lib/thinktank/concepts";
import { nextRefresherAt } from "@/lib/thinktank/refresh";

export const runtime = "nodejs";

/** Bookmark a concept, or drop the bookmark. No AI, no cost. */
export async function POST(req: Request) {
  let user;
  try {
    ({ user } = await requireUser());
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { slug?: string; saved?: boolean };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const slug = body.slug ? conceptSlug(body.slug) : "";
  if (!slug) return NextResponse.json({ error: "slug required" }, { status: 400 });

  const concept = await getConcept(user.id, slug);
  if (!concept) return NextResponse.json({ error: "Concept not found" }, { status: 404 });

  if (body.saved === false) {
    await db
      .delete(thinktankSaved)
      .where(
        and(eq(thinktankSaved.userId, user.id), eq(thinktankSaved.conceptId, concept.id)),
      );
    return NextResponse.json({ ok: true, saved: false });
  }

  // onConflictDoNothing keeps re-saving idempotent — and, importantly, stops a
  // second tap resetting a refresher schedule that is already part-way up the
  // ladder.
  await db
    .insert(thinktankSaved)
    .values({
      userId: user.id,
      conceptId: concept.id,
      nextRefresherAt: nextRefresherAt(0),
      refresherStage: 0,
    })
    .onConflictDoNothing({
      target: [thinktankSaved.userId, thinktankSaved.conceptId],
    });

  return NextResponse.json({ ok: true, saved: true });
}
