import { tool } from "ai";
import { z } from "zod";
import { retrieveFromDirectory, fetchItemContents, buildDirectoryMap } from "@/lib/ai/rag";
import { groundFromWeb, formatWebGround } from "@/lib/ai/web-search";
import { addMemory } from "@/lib/ai/memory";
import type { AgentSource } from "./stream";

/**
 * Collects the library items the agent touches across tool calls, assigning a
 * stable [n] citation number to each on first sighting, so the final answer can
 * cite them and the client can render the source list.
 */
export type SourceSink = {
  cite: (item: Omit<AgentSource, "n">) => number;
  idsFor: (ns: number[]) => string[];
  list: () => AgentSource[];
};

export function createSourceSink(): SourceSink {
  const byId = new Map<string, AgentSource>();
  let counter = 0;
  return {
    cite(item) {
      const existing = byId.get(item.directoryItemId);
      if (existing) return existing.n;
      const n = ++counter;
      byId.set(item.directoryItemId, { n, ...item });
      return n;
    },
    idsFor(ns) {
      const wanted = new Set(ns);
      return [...byId.values()].filter((s) => wanted.has(s.n)).map((s) => s.directoryItemId);
    },
    list() {
      return [...byId.values()].sort((a, b) => a.n - b.n);
    },
  };
}

/**
 * The agent's toolset, scoped to one user. Read tools wrap the RAG helpers +
 * web grounding; `remember` writes a durable fact. Search/read tools attach a
 * [n] citation number via the sink so the model can cite what it used.
 */
export function buildAgentTools(userId: string, sink: SourceSink) {
  return {
    search_library: tool({
      description:
        "Search the user's own library (notes, saved articles, uploaded documents) for items relevant to a query. Returns matches each prefixed with a [n] citation number you can cite and pass to read_item.",
      parameters: z.object({ query: z.string().min(1).describe("What to search for") }),
      execute: async ({ query }) => {
        const hits = await retrieveFromDirectory(userId, query, 8);
        if (hits.length === 0) return "No matching items in the user's library.";
        return hits
          .map((h) => {
            const n = sink.cite({
              directoryItemId: h.directoryItemId,
              title: h.title,
              kind: h.kind,
              similarity: h.similarity,
            });
            return `[${n}] (${h.kind}) ${h.title}\n${(h.snippet ?? "").slice(0, 300)}`;
          })
          .join("\n\n");
      },
    }),
    read_item: tool({
      description:
        "Read the FULL text of specific library items by their [n] citation numbers (from a prior search_library). Use this before making claims about an item's contents.",
      parameters: z.object({ citations: z.array(z.number().int()).min(1).max(5) }),
      execute: async ({ citations }) => {
        const ids = sink.idsFor(citations);
        if (ids.length === 0) return "Those citation numbers aren't known yet — run search_library first.";
        const contents = await fetchItemContents(userId, ids);
        if (contents.length === 0) return "Couldn't read those items.";
        return contents.map((c) => `[${c.title}]\n${c.content.slice(0, 3000)}`).join("\n\n---\n\n");
      },
    }),
    list_directory: tool({
      description:
        "List the folder/file structure of the user's library (titles and locations only, no content). Use to see what exists and where.",
      parameters: z.object({}),
      execute: async () => (await buildDirectoryMap(userId)).slice(0, 4000),
    }),
    web_search: tool({
      description:
        "Search the public web for current or external facts the user's library doesn't cover. Make clear which claims came from the web.",
      parameters: z.object({ query: z.string().min(1) }),
      execute: async ({ query }) => {
        try {
          const snips = await groundFromWeb(query);
          return snips.length > 0 ? formatWebGround(snips) : "No useful web results.";
        } catch {
          return "Web search is unavailable right now.";
        }
      },
    }),
    remember: tool({
      description:
        "Save a durable fact about the user to recall in future conversations (e.g. a goal, a preference, what they're studying). Use sparingly for genuinely lasting facts.",
      parameters: z.object({ fact: z.string().min(3).max(400) }),
      execute: async ({ fact }) => {
        const r = await addMemory(userId, fact);
        return r.ok ? `Remembered: ${fact}` : "Couldn't save that.";
      },
    }),
  };
}
