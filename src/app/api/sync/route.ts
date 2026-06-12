import { NextResponse } from "next/server";
import { runSync, syncStatus } from "@/lib/sync/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Desktop-only. The Electron main process (and the in-process loop) drive sync;
// this lets a manual "Sync now" menu item trigger it and report status.
function guard(): NextResponse | null {
  if (process.env.APP_RUNTIME !== "desktop") {
    return NextResponse.json({ error: "sync is desktop-only" }, { status: 404 });
  }
  return null;
}

export async function GET() {
  const blocked = guard();
  if (blocked) return blocked;
  return NextResponse.json(syncStatus());
}

export async function POST() {
  const blocked = guard();
  if (blocked) return blocked;
  const summary = await runSync();
  return NextResponse.json(summary, { status: summary.ok ? 200 : 500 });
}
