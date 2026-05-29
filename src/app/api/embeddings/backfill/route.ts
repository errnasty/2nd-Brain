import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { backfillEmbeddings } from "@/lib/embeddings/backfill";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  let user;
  try {
    ({ user } = await requireUser());
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Backfill embeds many items (paid). 5 manual runs / minute is plenty.
  const rl = await checkRateLimit(user.id, "backfill", 5, 60);
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: "Rate limit reached — wait a moment before refreshing memory again." },
      { status: 429 },
    );
  }

  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 500), 2000);

  try {
    const result = await backfillEmbeddings(user.id, limit);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
