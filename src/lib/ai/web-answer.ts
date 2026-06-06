import Anthropic from "@anthropic-ai/sdk";

// Sentinels appended to the end of the streamed body. The client slices the
// answer at the first sentinel and parses each payload. Kept in sync with the
// literals in the client components (route modules / libs can't share an
// exported const with route files cleanly, so they're duplicated by value).
export const WEBSOURCES_SENTINEL = "<<<SB_WEBSOURCES:";
export const USAGE_SENTINEL = "<<<SB_USAGE:";

export type WebSource = { title: string; url: string };

// Bound web-search cost: at most this many searches per answer.
const MAX_WEB_SEARCHES = 3;
const MAX_TOKENS = 1500;

type StreamArgs = {
  model: string;
  system: string;
  /** The single user turn (directory context + question, already assembled). */
  userContent: string;
  /** Prior conversation turns, oldest first. */
  history?: { role: "user" | "assistant"; content: string }[];
};

/**
 * Stream an Anthropic answer with the native web_search server tool enabled.
 * Directory context lives in `userContent` / `system` and is framed as the
 * priority source; web search is a fallback the model may call. The returned
 * stream emits answer text, then a WEBSOURCES sentinel (URLs actually cited),
 * then a USAGE sentinel.
 *
 * Isolated from the Vercel AI SDK path on purpose: the installed
 * @ai-sdk/anthropic (v1, AI SDK v4) doesn't expose the web-search tool, and a
 * full SDK v5 migration is higher-risk than this opt-in side path.
 */
/**
 * Non-streaming web-search synthesis. One Anthropic call with the native
 * web_search server tool; returns the full text + the URLs actually cited.
 * Used where we need the whole result at once (e.g. saving it as a note).
 */
export async function webAnswerOnce({
  model,
  system,
  userContent,
}: {
  model: string;
  system: string;
  userContent: string;
}): Promise<{ text: string; sources: WebSource[] }> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const msg = await client.messages.create({
    model,
    max_tokens: MAX_TOKENS,
    system,
    messages: [{ role: "user", content: userContent }],
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: MAX_WEB_SEARCHES }],
  });

  let text = "";
  const seen = new Set<string>();
  const sources: WebSource[] = [];
  for (const block of msg.content) {
    if (block.type !== "text") continue;
    text += block.text;
    if (!block.citations) continue;
    for (const c of block.citations) {
      if (c.type === "web_search_result_location" && c.url && !seen.has(c.url)) {
        seen.add(c.url);
        sources.push({ title: c.title ?? c.url, url: c.url });
      }
    }
  }
  return { text, sources };
}

/**
 * Plain (no-tool) one-shot completion. Fallback for environments where the
 * web_search server tool isn't enabled on the Anthropic org.
 */
export async function plainAnswerOnce({
  model,
  system,
  userContent,
}: {
  model: string;
  system: string;
  userContent: string;
}): Promise<{ text: string }> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const msg = await client.messages.create({
    model,
    max_tokens: MAX_TOKENS,
    system,
    messages: [{ role: "user", content: userContent }],
  });
  const text = msg.content
    .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("");
  return { text };
}

export function streamWebAnswer({ model, system, userContent, history }: StreamArgs): ReadableStream<Uint8Array> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const encoder = new TextEncoder();

  const messages: Anthropic.MessageParam[] = [
    ...(history ?? []).map((m) => ({ role: m.role, content: m.content })),
    { role: "user" as const, content: userContent },
  ];

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const stream = client.messages.stream({
          model,
          max_tokens: MAX_TOKENS,
          system,
          messages,
          tools: [{ type: "web_search_20250305", name: "web_search", max_uses: MAX_WEB_SEARCHES }],
        });

        stream.on("text", (delta) => controller.enqueue(encoder.encode(delta)));

        const final = await stream.finalMessage();

        // Collect the URLs Claude actually cited (not every search result), so
        // the source list stays relevant rather than dumping all hits.
        const seen = new Set<string>();
        const webSources: WebSource[] = [];
        for (const block of final.content) {
          if (block.type !== "text" || !block.citations) continue;
          for (const c of block.citations) {
            if (c.type === "web_search_result_location" && c.url && !seen.has(c.url)) {
              seen.add(c.url);
              webSources.push({ title: c.title ?? c.url, url: c.url });
            }
          }
        }

        controller.enqueue(encoder.encode(`\n${WEBSOURCES_SENTINEL}${JSON.stringify(webSources)}`));

        const usage = {
          promptTokens: final.usage?.input_tokens ?? 0,
          completionTokens: final.usage?.output_tokens ?? 0,
          totalTokens: (final.usage?.input_tokens ?? 0) + (final.usage?.output_tokens ?? 0),
        };
        controller.enqueue(encoder.encode(`\n${USAGE_SENTINEL}${JSON.stringify(usage)}`));
      } catch (err) {
        const msg = err instanceof Error ? err.message : "unknown";
        controller.enqueue(encoder.encode(`\n\n_(web search error: ${msg})_`));
      } finally {
        controller.close();
      }
    },
  });
}
