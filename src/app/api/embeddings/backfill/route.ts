import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { backfillEmbeddings } from "@/lib/embeddings/backfill";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Streaming backfill. Instead of looping all docs then returning one JSON blob
 * (which blows the load-balancer's ~10-15s inactivity timeout and yields an
 * HTML error page), we open a ReadableStream immediately and write a progress
 * line after every batch. The constant data flow keeps the connection alive.
 *
 * The final line is JSON prefixed with "DONE " so the client can parse the
 * summary off the end of the stream.
 */
export async function POST(req: Request) {
  let user;
  try {
    ({ user } = await requireUser());
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = await checkRateLimit(user.id, "backfill", 5, 60);
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: "Rate limit reached — wait a moment before refreshing memory again." },
      { status: 429 },
    );
  }

  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 500), 2000);
  const userId = user.id;

  const encoder = new TextEncoder();
  // Abort the embedding work + heartbeat when the client disconnects. Hoisted so
  // cancel() can reach them.
  const ac = new AbortController();
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  // Mirror a client disconnect (req.signal) into our controller.
  req.signal.addEventListener("abort", () => ac.abort(), { once: true });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (s: string) => {
        try {
          controller.enqueue(encoder.encode(s));
        } catch {
          /* stream closed/cancelled */
        }
      };
      // Heartbeat: emit a dot every 3s even if a batch is slow, so the proxy
      // always sees traffic. Cleared when work finishes or the client leaves.
      heartbeat = setInterval(() => write("·"), 3000);
      try {
        write("Refreshing memory…\n");
        const result = await backfillEmbeddings(userId, limit, (msg) => write(`${msg}\n`), ac.signal);
        const total = result.articlesEmbedded + result.chunksEmbedded + result.notesEmbedded;
        write(
          `\nDONE ${JSON.stringify({
            ok: true,
            total,
            ...result,
          })}\n`,
        );
      } catch (err) {
        if (!ac.signal.aborted) {
          write(`\nDONE ${JSON.stringify({ ok: false, error: err instanceof Error ? err.message : "Unknown error" })}\n`);
        }
      } finally {
        if (heartbeat) clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
    cancel() {
      // Client went away — stop the heartbeat and signal the backfill to stop
      // issuing further provider calls.
      if (heartbeat) clearInterval(heartbeat);
      ac.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "x-accel-buffering": "no", // disable proxy buffering so chunks flush
    },
  });
}
