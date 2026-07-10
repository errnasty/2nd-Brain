"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { DEFAULT_CHAT_MODEL } from "@/lib/ai/models";
import { RABBITHOLE_SENTINEL, displayText } from "@/lib/ai/stream-markers";
import { collectSubtreeIds, type RabbitholeLens } from "@/lib/rabbithole/lenses";

const MODEL_STORAGE_KEY = "ask.model.v1"; // shared with the Ask tab / DocQueryPanel

function getModel(): string {
  if (typeof window === "undefined") return DEFAULT_CHAT_MODEL;
  return window.localStorage.getItem(MODEL_STORAGE_KEY) || DEFAULT_CHAT_MODEL;
}

export type RhNode = {
  id: string;
  parentId: string | null;
  anchorText: string;
  question: string;
  lens: string | null;
  title: string;
  content: string;
  depth: number;
  createdAt: string;
};

export type RhDraft = {
  parentId: string | null;
  anchorText: string;
  question: string;
  lens: RabbitholeLens | null;
  content: string;
};

/**
 * The Rabbithole data engine, shared by the reader drawer, the split-view
 * branch panel, and the canvas. Owns node state, the streaming dig flow, and
 * subtree deletion. View components add their own selection/navigation UI.
 */
export function useRabbithole(itemId: string) {
  const [nodes, setNodes] = useState<RhNode[]>([]);
  const [draft, setDraft] = useState<RhDraft | null>(null);
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const childrenOf = useCallback(
    (parentId: string | null) => nodes.filter((n) => n.parentId === parentId),
    [nodes],
  );

  const pathTo = useCallback(
    (id: string | null): string[] => {
      const out: string[] = [];
      let cur = id ? byId.get(id) : null;
      let safety = 0;
      while (cur && safety < 32) {
        out.unshift(cur.id);
        cur = cur.parentId ? byId.get(cur.parentId) : null;
        safety += 1;
      }
      return out;
    },
    [byId],
  );

  // Load the item's existing hole; reset when the item changes.
  useEffect(() => {
    setNodes([]);
    setDraft(null);
    abortRef.current?.abort();
    setStreaming(false);
    if (!itemId) return;
    let aborted = false;
    fetch(`/api/rabbithole?itemId=${itemId}`, { cache: "no-store" })
      .then(async (r) => (r.ok ? ((await r.json()) as { nodes: RhNode[] }) : null))
      .then((data) => {
        if (!aborted && data) setNodes(data.nodes);
      })
      .catch(() => {});
    return () => {
      aborted = true;
    };
  }, [itemId]);

  useEffect(() => () => abortRef.current?.abort(), []);

  /**
   * Dig a branch off `parentId` from `anchorText`. Streams the answer into the
   * draft, then swaps it into `nodes` when the trailing sentinel lands.
   * Resolves with the saved node's id (or null on failure/abort).
   */
  const dig = useCallback(
    async (
      parentId: string | null,
      anchorText: string,
      lens: RabbitholeLens | null,
      q: string,
    ): Promise<string | null> => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setStreaming(true);
      setDraft({ parentId, anchorText, question: q, lens, content: "" });

      try {
        const res = await fetch("/api/rabbithole", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            itemId,
            parentId,
            anchorText,
            question: q || undefined,
            lens: lens ?? undefined,
            model: getModel(),
          }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          const msg = await res.text().catch(() => "");
          toast.error(msg || `Request failed (${res.status})`);
          setDraft(null);
          return null;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let acc = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          acc += decoder.decode(value, { stream: true });
          const display = displayText(acc);
          setDraft((d) => (d ? { ...d, content: display } : d));
        }

        const idx = acc.indexOf(RABBITHOLE_SENTINEL);
        if (idx >= 0) {
          const payload = JSON.parse(acc.slice(idx + RABBITHOLE_SENTINEL.length)) as {
            id: string;
            parentId: string | null;
            title: string;
            depth: number;
          };
          const saved: RhNode = {
            id: payload.id,
            parentId: payload.parentId,
            anchorText,
            question: q,
            lens,
            title: payload.title,
            content: displayText(acc),
            depth: payload.depth,
            createdAt: new Date().toISOString(),
          };
          setNodes((ns) => [...ns, saved]);
          setDraft(null);
          return payload.id;
        }
        return null;
      } catch (err) {
        if ((err as Error)?.name !== "AbortError") {
          toast.error(err instanceof Error ? err.message : "Request failed");
        }
        setDraft(null);
        return null;
      } finally {
        setStreaming(false);
      }
    },
    [itemId],
  );

  /** Delete a branch and its whole subtree. Returns the removed ids. */
  const deleteBranch = useCallback(
    async (id: string): Promise<string[] | null> => {
      const doomed = collectSubtreeIds(nodes, id);
      try {
        const res = await fetch(`/api/rabbithole/${id}`, { method: "DELETE" });
        if (!res.ok) throw new Error(await res.text().catch(() => `Request failed (${res.status})`));
        const gone = new Set(doomed);
        setNodes((ns) => ns.filter((n) => !gone.has(n.id)));
        toast.success("Branch deleted");
        return doomed;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Delete failed");
        return null;
      }
    },
    [nodes],
  );

  return {
    nodes,
    draft,
    streaming,
    byId,
    childrenOf,
    pathTo,
    dig,
    deleteBranch,
    setNodes,
  };
}
