"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { GitCompareArrows, Link2, Zap } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

type Connection = {
  itemId: string;
  title: string;
  kind: "saved_article" | "uploaded_document" | "user_note";
  similarity: number;
  relation: "connection" | "tension";
  reason: string;
};

/**
 * Opt-in "Implicit connections & tensions" for the open Directory item. Nothing
 * runs until the user clicks — it's an embedding search + a Haiku call, so we
 * don't spend tokens on every open.
 */
export function ConnectionsPanel({ itemId }: { itemId: string }) {
  const router = useRouter();
  const [items, setItems] = useState<Connection[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [opened, setOpened] = useState(false);
  const [error, setError] = useState(false);

  function load() {
    setOpened(true);
    setLoading(true);
    setItems(null);
    setError(false);
    fetch("/api/connections", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ itemId }),
    })
      .then(async (res) => {
        // Don't collapse a failure into an empty result — they read identically.
        if (!res.ok) {
          setError(true);
          return;
        }
        const data = await res.json();
        setItems(data.items ?? []);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }

  const connections = items?.filter((i) => i.relation === "connection") ?? [];
  const tensions = items?.filter((i) => i.relation === "tension") ?? [];

  return (
    <div className="not-prose mt-8 border-t border-border pt-6">
      {!opened ? (
        <button
          onClick={load}
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
        >
          <GitCompareArrows className="h-3.5 w-3.5" />
          Find connections &amp; tensions
        </button>
      ) : loading ? (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-3/4" />
        </div>
      ) : error ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Couldn&apos;t analyze connections.</span>
          <button onClick={load} className="font-medium text-primary underline underline-offset-2">
            Try again
          </button>
        </div>
      ) : items && items.length === 0 ? (
        <div className="text-xs text-muted-foreground">No strong connections found.</div>
      ) : (
        <div className="space-y-5">
          {connections.length > 0 && (
            <Group
              icon={<Link2 className="h-3.5 w-3.5" />}
              label="Implicit connections"
              items={connections}
              onOpen={(id) => router.push(`/directory?item=${id}`)}
            />
          )}
          {tensions.length > 0 && (
            <Group
              icon={<Zap className="h-3.5 w-3.5 text-amber-500" />}
              label="Tensions found"
              items={tensions}
              onOpen={(id) => router.push(`/directory?item=${id}`)}
              accent
            />
          )}
        </div>
      )}
    </div>
  );
}

function Group({
  icon,
  label,
  items,
  onOpen,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  items: Connection[];
  onOpen: (id: string) => void;
  accent?: boolean;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </div>
      <ul className="space-y-1.5">
        {items.map((it) => (
          <li key={it.itemId}>
            <button
              onClick={() => onOpen(it.itemId)}
              className={`group w-full rounded-md border p-2.5 text-left transition-colors hover:bg-accent/50 ${
                accent ? "border-amber-500/30" : "border-border"
              }`}
            >
              <div className="text-sm font-medium leading-snug group-hover:underline">{it.title}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">{it.reason}</div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
