import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { rabbitholeNodes } from "@/lib/db/schema";
import { getApiUser } from "@/lib/auth";
import { collectSubtreeIds } from "@/lib/rabbithole/lenses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DELETE /api/rabbithole/:id — remove a branch AND everything dug from it.
 * parent_id has no FK cascade, so the subtree is collected in app code from
 * the hole's (small) node list and deleted in one statement.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, error } = await getApiUser();
  if (!user) return NextResponse.json({ error: error?.message }, { status: error?.status });

  const [node] = await db
    .select({ id: rabbitholeNodes.id, itemId: rabbitholeNodes.itemId })
    .from(rabbitholeNodes)
    .where(and(eq(rabbitholeNodes.id, id), eq(rabbitholeNodes.userId, user.id)))
    .limit(1);
  if (!node) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const siblings = await db
    .select({ id: rabbitholeNodes.id, parentId: rabbitholeNodes.parentId })
    .from(rabbitholeNodes)
    .where(and(eq(rabbitholeNodes.userId, user.id), eq(rabbitholeNodes.itemId, node.itemId)));

  const doomed = collectSubtreeIds(siblings, id);
  await db
    .delete(rabbitholeNodes)
    .where(and(eq(rabbitholeNodes.userId, user.id), inArray(rabbitholeNodes.id, doomed)));

  return NextResponse.json({ ok: true, deleted: doomed.length });
}
