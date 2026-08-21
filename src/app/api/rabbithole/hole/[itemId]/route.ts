import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { rabbitholeNodes } from "@/lib/db/schema";
import { getApiUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DELETE /api/rabbithole/hole/:itemId — remove an ENTIRE hole: every branch
 * ever dug from this Directory item.
 *
 * The sibling route (`/api/rabbithole/:id`) deletes one branch and its
 * subtree, which is the right tool while you are reading. It is the wrong tool
 * for abandoning a hole: doing that meant deleting top-level branches one at a
 * time, and the hole stayed in the list until the last one went.
 *
 * The Directory item itself is untouched — a hole is the questions you asked
 * about a document, not the document. Deleting the hole leaves the source
 * exactly where it was, ready to be dug again.
 *
 * Deleting nothing is still a 200: the caller asked for this hole to be gone,
 * and it is. Only a missing user is an error.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await params;
  const { user, error } = await getApiUser();
  if (!user) return NextResponse.json({ error: error?.message }, { status: error?.status });

  const doomed = await db
    .delete(rabbitholeNodes)
    .where(and(eq(rabbitholeNodes.userId, user.id), eq(rabbitholeNodes.itemId, itemId)))
    .returning({ id: rabbitholeNodes.id });

  return NextResponse.json({ ok: true, deleted: doomed.length });
}
