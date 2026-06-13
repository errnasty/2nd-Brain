import { NextResponse } from "next/server";
import { getPgliteClient } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Desktop-only: multi-device edit conflicts recorded by the sync engine. GET
// lists unresolved ones (incl. the lost local text so the user can recover it);
// POST dismisses one or all.

function guardClient() {
  if (process.env.APP_RUNTIME !== "desktop") return null;
  return getPgliteClient();
}

export async function GET() {
  const pg = guardClient();
  if (!pg) return NextResponse.json({ error: "desktop-only" }, { status: 404 });
  try {
    const r = (await pg.query(
      `select row_id, title, local_content, local_updated_at, remote_updated_at, detected_at
       from sync_conflicts where resolved = false order by detected_at desc limit 50`,
    )) as { rows: unknown[] };
    return NextResponse.json({ conflicts: r.rows, count: r.rows.length });
  } catch {
    // Table may not exist yet on a brand-new DB.
    return NextResponse.json({ conflicts: [], count: 0 });
  }
}

export async function POST(req: Request) {
  const pg = guardClient();
  if (!pg) return NextResponse.json({ error: "desktop-only" }, { status: 404 });
  let body: { action?: string; rowId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (body.action === "dismissAll") {
    await pg.query("update sync_conflicts set resolved = true where resolved = false");
  } else if (body.action === "dismiss" && body.rowId) {
    await pg.query("update sync_conflicts set resolved = true where row_id = $1", [body.rowId]);
  } else {
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
