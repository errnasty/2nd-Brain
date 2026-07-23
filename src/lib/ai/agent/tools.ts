import { tool } from "ai";
import { z } from "zod";
import { retrieveFromDirectory, fetchItemContents, buildDirectoryMap } from "@/lib/ai/rag";
import { groundFromWeb, formatWebGround } from "@/lib/ai/web-search";
import { addMemory } from "@/lib/ai/memory";
import type { AgentSource, AgentProposal } from "./stream";

/** Emits a proposed Directory write for the client to Approve/Discard — the
 *  tool never mutates directly (see AgentProposal in stream.ts). */
export type ProposalSink = (p: AgentProposal) => void;

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
export function buildAgentTools(userId: string, sink: SourceSink, onProposal?: ProposalSink) {
  return {
    search_library: tool({
      description:
        "Search the user's own library (notes, saved articles, uploaded documents) for items relevant to a query. Returns matches each prefixed with a [n] citation number you can cite and pass to read_item.",
      parameters: z.object({ query: z.string().min(1).describe("What to search for") }),
      execute: async ({ query }) => {
        try {
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
        } catch {
          return "Library search is unavailable right now.";
        }
      },
    }),
    read_item: tool({
      description:
        "Read the FULL text of specific library items by their [n] citation numbers (from a prior search_library). Use this before making claims about an item's contents.",
      parameters: z.object({ citations: z.array(z.number().int()).min(1).max(5) }),
      execute: async ({ citations }) => {
        const ids = sink.idsFor(citations);
        if (ids.length === 0) return "Those citation numbers aren't known yet — run search_library first.";
        try {
          const contents = await fetchItemContents(userId, ids);
          if (contents.length === 0) return "Couldn't read those items.";
          return contents.map((c) => `[${c.title}]\n${c.content.slice(0, 3000)}`).join("\n\n---\n\n");
        } catch {
          return "Couldn't read those items right now.";
        }
      },
    }),
    list_directory: tool({
      description:
        "List the folder/file structure of the user's library (titles and locations only, no content). Use to see what exists and where.",
      parameters: z.object({}),
      execute: async () => {
        try {
          return (await buildDirectoryMap(userId)).slice(0, 4000);
        } catch {
          return "The library structure is unavailable right now.";
        }
      },
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

    // ── Directory write tools ──────────────────────────────────────────
    // None of these mutate anything. Each records a proposal via onProposal
    // and returns a short status string so the model continues coherently;
    // the actual write only happens if the user approves it client-side
    // (POST /api/agent/apply), which re-runs the real server action.
    create_note: tool({
      description:
        "Propose creating a new note in the user's Directory. This does NOT save it — the user must approve the proposal first.",
      parameters: z.object({
        title: z.string().min(1).max(300),
        content: z.string().max(200000).optional(),
        folderId: z.string().uuid().nullish(),
      }),
      execute: async ({ title, content, folderId }) => {
        onProposal?.({ id: crypto.randomUUID(), action: "create_note", title, content, folderId });
        return `Proposed creating note "${title}" — awaiting the user's approval.`;
      },
    }),
    append_to_note: tool({
      description:
        "Propose appending text to an existing note (use an item found via search_library/list_directory). This does NOT save — awaiting the user's approval.",
      parameters: z.object({
        itemId: z.string().uuid(),
        itemTitle: z.string().min(1),
        text: z.string().min(1).max(50000),
      }),
      execute: async ({ itemId, itemTitle, text }) => {
        onProposal?.({ id: crypto.randomUUID(), action: "append_note", itemId, itemTitle, text });
        return `Proposed appending to "${itemTitle}" — awaiting the user's approval.`;
      },
    }),
    add_task: tool({
      description:
        "Propose adding a to-do item to an existing note (rendered as a checkbox line). This does NOT save — awaiting the user's approval.",
      parameters: z.object({
        itemId: z.string().uuid(),
        itemTitle: z.string().min(1),
        text: z.string().min(1).max(300),
      }),
      execute: async ({ itemId, itemTitle, text }) => {
        onProposal?.({ id: crypto.randomUUID(), action: "add_task", itemId, itemTitle, text });
        return `Proposed adding task "${text}" to "${itemTitle}" — awaiting the user's approval.`;
      },
    }),
    move_item: tool({
      description:
        "Propose moving an item to a different folder (or Unsorted, with folderId null). This does NOT move it — awaiting the user's approval.",
      parameters: z.object({
        itemId: z.string().uuid(),
        itemTitle: z.string().min(1),
        folderId: z.string().uuid().nullable(),
        folderName: z.string().min(1),
      }),
      execute: async ({ itemId, itemTitle, folderId, folderName }) => {
        onProposal?.({ id: crypto.randomUUID(), action: "move", itemId, itemTitle, folderId, folderName });
        return `Proposed moving "${itemTitle}" to ${folderName} — awaiting the user's approval.`;
      },
    }),
    create_folder: tool({
      description: "Propose creating a new folder. This does NOT create it — awaiting the user's approval.",
      parameters: z.object({ name: z.string().min(1).max(60), parentId: z.string().uuid().nullish() }),
      execute: async ({ name, parentId }) => {
        onProposal?.({ id: crypto.randomUUID(), action: "create_folder", name, parentId });
        return `Proposed creating folder "${name}" — awaiting the user's approval.`;
      },
    }),
    tag_item: tool({
      description:
        "Propose auto-tagging an item with AI-suggested tags. This does NOT tag it — awaiting the user's approval.",
      parameters: z.object({ itemId: z.string().uuid(), itemTitle: z.string().min(1) }),
      execute: async ({ itemId, itemTitle }) => {
        onProposal?.({ id: crypto.randomUUID(), action: "autotag", itemId, itemTitle });
        return `Proposed tagging "${itemTitle}" — awaiting the user's approval.`;
      },
    }),
    delete_item: tool({
      description:
        "Propose permanently deleting an item. This is destructive and irreversible, so it ALWAYS requires the user's explicit approval — this tool never deletes anything itself.",
      parameters: z.object({ itemId: z.string().uuid(), itemTitle: z.string().min(1) }),
      execute: async ({ itemId, itemTitle }) => {
        onProposal?.({ id: crypto.randomUUID(), action: "delete", itemId, itemTitle });
        return `Proposed deleting "${itemTitle}" — awaiting the user's approval (this is permanent).`;
      },
    }),
  };
}
