// NDJSON event protocol for the Agent turn. The agent interleaves streamed
// answer text with tool-step events (which tool ran, its status), so the
// single-end-of-stream sentinel scheme (stream-markers.ts) can't represent it.
// One JSON object per line; the client parses incrementally.

export type AgentSource = {
  n: number;
  directoryItemId: string;
  title: string;
  kind: "saved_article" | "uploaded_document" | "user_note";
  similarity: number;
};

export type AgentEvent =
  | { type: "text"; delta: string }
  | { type: "tool"; id: string; label: string; status: "start" | "done" }
  | { type: "note"; message: string } // e.g. model fell back to a tool-capable one
  | { type: "sources"; sources: AgentSource[] }
  | { type: "usage"; usage: { promptTokens: number; completionTokens: number; totalTokens: number } }
  | { type: "error"; message: string };

/** One event → one NDJSON line. */
export function encodeEvent(e: AgentEvent): string {
  return JSON.stringify(e) + "\n";
}

/**
 * Parse whatever complete NDJSON lines are in `buffer`, returning the events
 * and the leftover partial line (which the caller prepends to the next chunk).
 */
export function parseEvents(buffer: string): { events: AgentEvent[]; rest: string } {
  const lines = buffer.split("\n");
  const rest = lines.pop() ?? ""; // trailing partial (or "" if buffer ended in \n)
  const events: AgentEvent[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    try {
      events.push(JSON.parse(t) as AgentEvent);
    } catch {
      // skip a malformed line rather than aborting the whole stream
    }
  }
  return { events, rest };
}
