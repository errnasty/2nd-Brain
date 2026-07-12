import Link from "next/link";
import { FileText, Newspaper, NotebookPen, Search, Sparkles } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { searchLibrary, type SearchHit, type SearchKindFilter } from "@/lib/search";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const FILTERS: { value: SearchKindFilter; label: string }[] = [
  { value: "all", label: "Everything" },
  { value: "articles", label: "Articles" },
  { value: "notes", label: "Notes" },
  { value: "documents", label: "Documents" },
];

function parseKind(v: string | undefined): SearchKindFilter {
  return v === "articles" || v === "notes" || v === "documents" ? v : "all";
}

function HitIcon({ kind }: { kind: SearchHit["kind"] }) {
  const cls = "h-4 w-4 shrink-0 text-muted-foreground";
  if (kind === "article" || kind === "saved_article") return <Newspaper className={cls} />;
  if (kind === "uploaded_document") return <FileText className={cls} />;
  return <NotebookPen className={cls} />;
}

function HitRow({ hit }: { hit: SearchHit }) {
  return (
    <Link
      href={hit.href}
      className="flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-accent"
    >
      <span className="mt-0.5">
        <HitIcon kind={hit.kind} />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{hit.title}</span>
        {hit.snippet && (
          <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">
            {hit.snippet}
          </span>
        )}
      </span>
      {typeof hit.similarity === "number" && (
        <span className="ml-auto mt-0.5 shrink-0 font-mono text-[10px] text-muted-foreground">
          {(hit.similarity * 100).toFixed(0)}%
        </span>
      )}
    </Link>
  );
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; kind?: string }>;
}) {
  const { user } = await requireUser();
  const params = await searchParams;
  const q = (params.q ?? "").trim();
  const kind = parseKind(params.kind);

  const results = q.length >= 2 ? await searchLibrary(user.id, q, kind) : null;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-6 py-10">
        <header className="editorial-rule mb-6 pb-4">
          <div className="editorial-eyebrow mb-2">Library · Search</div>
          <h1
            className="editorial-display m-0"
            style={{ fontSize: "clamp(1.875rem, 3.6vw, 2.625rem)" }}
          >
            Search
          </h1>
        </header>

        <form method="get" action="/search" className="flex gap-2">
          <Input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Search articles, notes, and documents…"
            autoFocus
            className="h-10"
          />
          {kind !== "all" && <input type="hidden" name="kind" value={kind} />}
          <Button type="submit" className="h-10">
            <Search className="mr-1.5 h-4 w-4" />
            Search
          </Button>
        </form>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <Link
              key={f.value}
              href={
                q
                  ? `/search?q=${encodeURIComponent(q)}${f.value === "all" ? "" : `&kind=${f.value}`}`
                  : `/search${f.value === "all" ? "" : `?kind=${f.value}`}`
              }
              className={cn(
                "rounded-full border px-3 py-1 text-xs transition-colors",
                kind === f.value
                  ? "border-foreground bg-foreground text-background"
                  : "border-border text-muted-foreground hover:bg-accent",
              )}
            >
              {f.label}
            </Link>
          ))}
        </div>

        {!results ? (
          <p className="mt-10 text-center text-sm text-muted-foreground">
            Type at least two characters to search your whole library — keyword matches plus
            semantic (&ldquo;about this topic&rdquo;) matches when embeddings are available.
          </p>
        ) : results.keyword.length === 0 && results.semantic.length === 0 ? (
          <p className="mt-10 text-center text-sm text-muted-foreground">
            No matches for &ldquo;{q}&rdquo;{kind !== "all" ? ` in ${kind}` : ""}.
          </p>
        ) : (
          <div className="mt-8 space-y-8">
            {results.semantic.length > 0 && (
              <section>
                <div className="editorial-eyebrow mb-2 flex items-center gap-1.5">
                  <Sparkles className="h-3 w-3" />
                  About this topic
                </div>
                <div className="divide-y divide-border/60 rounded-xl border border-border">
                  {results.semantic.map((h) => (
                    <HitRow key={`s-${h.id}`} hit={h} />
                  ))}
                </div>
              </section>
            )}
            {results.keyword.length > 0 && (
              <section>
                <div className="editorial-eyebrow mb-2">Keyword matches</div>
                <div className="divide-y divide-border/60 rounded-xl border border-border">
                  {results.keyword.map((h) => (
                    <HitRow key={`k-${h.kind}-${h.id}`} hit={h} />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
