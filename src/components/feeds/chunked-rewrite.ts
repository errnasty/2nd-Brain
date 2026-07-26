/**
 * Walks a chunk-addressed rewrite endpoint (translate / simplify) and streams
 * the result back as it arrives.
 *
 * Why chunks at all: the app is hosted where a synchronous function is killed
 * at ~10 seconds, so a whole-article rewrite cannot happen in one request. The
 * server does one chunk per call and reports how many there are; this walks
 * them in order and hands back the text so far after each, so a long article
 * fills in from the top instead of showing a spinner and then failing.
 *
 * A failure part-way through keeps what already arrived rather than throwing it
 * away — half a translated article is far more use than an error toast.
 */

export type RewriteResult =
  | { status: "ok"; title: string; content: string; partial: boolean }
  /** The server says the article is already in the requested language. */
  | { status: "conflict"; sourceLang: string | null }
  | { status: "error"; message: string }
  /** The reader moved to another article mid-walk; the caller should discard. */
  | { status: "stale" };

/** Runaway guard: a malformed chunkCount must not loop forever. */
const MAX_CHUNKS = 40;

export async function walkChunks(
  url: string,
  body: Record<string, unknown>,
  opts: {
    /** Called after every chunk with everything received so far. */
    onProgress?: (partial: { title: string; content: string }) => void;
    /** Return true once the result is no longer wanted (reader paged away). */
    isStale?: () => boolean;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<RewriteResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  let title = "";
  let content = "";
  let count = 1;

  for (let i = 0; i < count && i < MAX_CHUNKS; i++) {
    let res: Response;
    try {
      res = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...body, chunk: i }),
      });
    } catch {
      // Network drop: keep whatever landed, flag it as incomplete.
      if (content) return { status: "ok", title, content, partial: true };
      return { status: "error", message: "Couldn't reach the server. Check your connection." };
    }

    if (opts.isStale?.()) return { status: "stale" };

    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;

    if (res.status === 409) {
      return {
        status: "conflict",
        sourceLang: typeof data.sourceLang === "string" ? data.sourceLang : null,
      };
    }

    if (!res.ok || typeof data.content !== "string") {
      if (content) return { status: "ok", title, content, partial: true };
      return {
        status: "error",
        message: typeof data.error === "string" ? data.error : "That didn't work. Try again.",
      };
    }

    content += data.content;
    if (typeof data.title === "string" && data.title.trim()) title = data.title.trim();
    if (Number.isInteger(data.chunkCount) && (data.chunkCount as number) > 0) {
      count = data.chunkCount as number;
    }
    opts.onProgress?.({ title, content });
  }

  return { status: "ok", title, content, partial: count > MAX_CHUNKS };
}
