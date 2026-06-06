"use client";

import * as React from "react";
import { useEffect, useRef, useState, useTransition } from "react";
import { ChevronLeft, ChevronRight, CornerUpLeft, ExternalLink, Eye, Library, Pencil, Sparkles, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, formatRelativeTime } from "@/lib/utils";
import {
  deleteDirectoryItemAction,
  updateNoteAction,
} from "@/app/(app)/directory/actions";
import { toast } from "sonner";
import type { DirectoryListItem } from "./directory-shell";
import { DocQueryPanel } from "@/components/reader/doc-query-panel";

type ResolvedLink = { title: string; id: string | null };
type Backlink = { id: string; title: string; kind: string };

type FullItem = {
  id: string;
  title: string;
  kind: "saved_article" | "uploaded_document" | "user_note";
  content: string | null;
  sourceUrl: string | null;
  articleId: string | null;
  documentId: string | null;
  docKind: "pdf" | "markdown" | "text" | "epub" | null;
  docFullText: string | null;
  breadcrumb: { id: string; name: string }[];
  outgoingLinks?: ResolvedLink[];
  backlinks?: Backlink[];
};

type ArticleContent = { fullText: string | null; excerpt: string | null; url: string };

const WIKILINK_RE = /\[\[([^\]|]+?)(?:\|([^\]]+))?\]\]/g;

/**
 * Turn [[Title]] / [[Title|alias]] into markdown links the ReactMarkdown `a`
 * handler routes to ?item=<id>. Resolved → app link; missing → a marker link
 * (#missing) the renderer styles dim/red. Square brackets escaped so stray
 * ones don't break markdown.
 */
function linkifyWikilinks(md: string, links: ResolvedLink[]): string {
  const byLower = new Map(links.map((l) => [l.title.toLowerCase(), l.id]));
  return md.replace(WIKILINK_RE, (_full, rawTitle: string, alias?: string) => {
    const title = rawTitle.trim();
    const label = (alias ?? title).trim();
    const id = byLower.get(title.toLowerCase()) ?? null;
    if (id) return `[${label}](?item=${id})`;
    return `[${label}](#missing-wikilink)`;
  });
}

export function ItemViewer({
  item,
  onClose,
}: {
  item: DirectoryListItem | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [mode, setMode] = useState<"preview" | "edit">("preview");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [full, setFull] = useState<FullItem | null>(null);
  const [fullLoading, setFullLoading] = useState(false);
  const [articleData, setArticleData] = useState<ArticleContent | null>(null);
  const [queryOpen, setQueryOpen] = useState(false);
  const lastSavedRef = useRef<{ title: string; content: string }>({ title: "", content: "" });

  // Fetch full content from /api/directory/:id whenever the selected item changes.
  useEffect(() => {
    if (!item) {
      setFull(null);
      setArticleData(null);
      return;
    }
    setTitle(item.title);
    setContent("");
    setDirty(false);
    setQueryOpen(false);
    setMode(item.kind === "user_note" ? "edit" : "preview");
    setArticleData(null);
    setFullLoading(true);

    let aborted = false;
    fetch(`/api/directory/${item.id}`, { cache: "no-store" })
      .then(async (r) => (r.ok ? ((await r.json()) as FullItem) : null))
      .then((data) => {
        if (aborted || !data) return;
        setFull(data);
        if (data.kind === "user_note") {
          setContent(data.content ?? "");
          lastSavedRef.current = { title: data.title, content: data.content ?? "" };
        } else if (data.kind === "uploaded_document") {
          // Seed the editor from the FULL doc text (not the truncated preview).
          const body = data.docFullText ?? data.content ?? "";
          setContent(body);
          lastSavedRef.current = { title: data.title, content: body };
        }
      })
      .finally(() => !aborted && setFullLoading(false));

    return () => {
      aborted = true;
    };
  }, [item?.id]);

  // For saved articles, hit the existing article endpoints for the rendered body.
  useEffect(() => {
    if (!full || full.kind !== "saved_article" || !full.articleId) return;
    let aborted = false;
    fetch(`/api/articles/${full.articleId}`, { cache: "no-store" })
      .then(async (res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (aborted || !data) return;
        setArticleData({
          fullText: data.fullText ?? null,
          excerpt: data.excerpt ?? null,
          url: data.url,
        });
        if (!data.fullText) {
          fetch(`/api/articles/${full.articleId}/full-text`, { method: "POST" })
            .then((r) => (r.ok ? r.json() : null))
            .then((res) => {
              if (aborted || !res?.content) return;
              setArticleData((prev) => (prev ? { ...prev, fullText: res.content } : prev));
            });
        }
      });
    return () => {
      aborted = true;
    };
  }, [full?.id, full?.kind, full?.articleId]);

  // Debounced autosave for editable items (notes + uploaded documents).
  useEffect(() => {
    if (!item || (item.kind !== "user_note" && item.kind !== "uploaded_document")) return;
    if (!dirty) return;
    const handle = setTimeout(() => {
      const t = title.trim() || (item.kind === "user_note" ? "Untitled note" : "Untitled");
      const c = content;
      if (t === lastSavedRef.current.title && c === lastSavedRef.current.content) return;
      startTransition(async () => {
        const r = await updateNoteAction({ id: item.id, title: t, content: c });
        if (r.ok) {
          lastSavedRef.current = { title: t, content: c };
          setDirty(false);
        }
      });
    }, 800);
    return () => clearTimeout(handle);
  }, [title, content, dirty, item?.id, item?.kind]);

  function handleDelete() {
    if (!item) return;
    if (!confirm(`Delete "${item.title}"? This cannot be undone.`)) return;
    startTransition(async () => {
      await deleteDirectoryItemAction(item.id);
      toast.success("Item deleted");
      onClose();
    });
  }

  if (!item) {
    return (
      <section className="hidden flex-1 items-center justify-center text-sm text-muted-foreground lg:flex">
        Select an item to read or edit
      </section>
    );
  }

  const isNote = item.kind === "user_note";
  const isArticle = item.kind === "saved_article";
  const isDoc = item.kind === "uploaded_document";
  const isMarkdownDoc = isDoc && full?.docKind === "markdown";
  const docBody = full?.docFullText ?? full?.content ?? "";
  const outgoing = full?.outgoingLinks ?? [];
  const backlinks = full?.backlinks ?? [];

  // ReactMarkdown link handler: intercept wikilink hrefs and route them in-app.
  const mdComponents = {
    a: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => {
      if (href === "#missing-wikilink") {
        return (
          <span
            className="rounded bg-destructive/10 px-1 text-destructive/80"
            title="No matching item — create a note with this title"
          >
            {children}
          </span>
        );
      }
      if (href?.startsWith("?item=")) {
        const id = href.slice("?item=".length);
        return (
          <button
            onClick={() => router.push(`/directory?item=${id}`)}
            className="text-primary underline underline-offset-2 hover:opacity-80"
          >
            {children}
          </button>
        );
      }
      return (
        <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
          {children}
        </a>
      );
    },
  } as const;

  return (
    <section className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-1 border-b border-border px-3 py-2">
        <Button size="sm" variant="ghost" onClick={onClose} className="md:hidden -ml-1 gap-1 px-2">
          <ChevronLeft className="h-4 w-4" />
          Back
        </Button>
        <div className="flex flex-1 items-center gap-2 text-xs text-muted-foreground">
          <span className="capitalize">{item.kind.replace("_", " ")}</span>
          <span>·</span>
          <span>{formatRelativeTime(item.updatedAt)}</span>
          {dirty && <span className="italic">· unsaved</span>}
        </div>

        {(isNote || isDoc) && (
          <div className="flex items-center rounded-md border border-border p-0.5">
            <button
              onClick={() => setMode("edit")}
              className={cn(
                "rounded px-2 py-0.5 text-xs transition-colors",
                mode === "edit"
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Pencil className="mr-1 inline h-3 w-3" /> Edit
            </button>
            <button
              onClick={() => setMode("preview")}
              className={cn(
                "rounded px-2 py-0.5 text-xs transition-colors",
                mode === "preview"
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Eye className="mr-1 inline h-3 w-3" /> Preview
            </button>
          </div>
        )}

        {isArticle && articleData?.url && (
          <Button size="icon" variant="ghost" asChild title="Open original">
            <a href={articleData.url} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4" />
            </a>
          </Button>
        )}

        <Button
          size="icon"
          variant="ghost"
          onClick={() => setQueryOpen((v) => !v)}
          title="Ask about this item"
          className={queryOpen ? "text-primary" : ""}
        >
          <Sparkles className="h-4 w-4" />
        </Button>

        <Button size="icon" variant="ghost" onClick={handleDelete} title="Delete">
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="mx-auto max-w-[68ch] px-6 py-8">
          {/* Breadcrumb */}
          {full && (
            <nav
              aria-label="Folder path"
              className="not-prose mb-3 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground"
            >
              <button
                onClick={() => router.push("/directory")}
                className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
              >
                <Library className="h-3 w-3" />
                Directory
              </button>
              {full.breadcrumb.length === 0 ? (
                <>
                  <ChevronRight className="h-3 w-3 opacity-50" />
                  <span className="italic">Unsorted</span>
                </>
              ) : (
                full.breadcrumb.map((b) => (
                  <span key={b.id} className="inline-flex items-center gap-1">
                    <ChevronRight className="h-3 w-3 opacity-50" />
                    <button
                      onClick={() => router.push(`/directory?folder=${b.id}`)}
                      className="hover:text-foreground transition-colors"
                    >
                      {b.name}
                    </button>
                  </span>
                ))
              )}
            </nav>
          )}

          {/* Title */}
          {(isNote || isDoc) && mode === "edit" ? (
            <Input
              value={title}
              onChange={(e) => { setTitle(e.target.value); setDirty(true); }}
              className="border-0 px-0 text-2xl font-bold tracking-tight shadow-none focus-visible:ring-0"
              placeholder="Title"
            />
          ) : (
            <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          )}

          <Separator className="my-6" />

          {/* Body */}
          {fullLoading && !isNote && (
            <div className="space-y-3">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
            </div>
          )}

          {isNote && mode === "edit" && (
            <Textarea
              value={content}
              onChange={(e) => { setContent(e.target.value); setDirty(true); }}
              placeholder={"Start writing your note in Markdown…\n\n# Heading\n\nA list:\n- item one\n- item two\n\nLinks, **bold**, _italic_, `code`, all work."}
              className="min-h-[60vh] resize-none border-0 px-0 text-[1.05rem] leading-[1.85] shadow-none focus-visible:ring-0"
            />
          )}

          {isNote && mode === "preview" && (
            <div className="prose-reader">
              {content.trim() ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                  {linkifyWikilinks(content, outgoing)}
                </ReactMarkdown>
              ) : (
                <p className="text-muted-foreground italic">Empty note. Switch to Edit to write.</p>
              )}
            </div>
          )}

          {isArticle && !fullLoading && (
            <div className="prose-reader">
              {articleData?.fullText ? (
                <div dangerouslySetInnerHTML={{ __html: articleData.fullText }} />
              ) : articleData?.excerpt ? (
                <p>{articleData.excerpt}</p>
              ) : (
                <p className="text-muted-foreground italic">Article body not available.</p>
              )}
            </div>
          )}

          {isDoc && mode === "edit" && (
            <Textarea
              value={content}
              onChange={(e) => { setContent(e.target.value); setDirty(true); }}
              placeholder="Document text… edits re-index this document for Ask."
              className="min-h-[60vh] resize-none border-0 px-0 text-[1.05rem] leading-[1.85] shadow-none focus-visible:ring-0"
            />
          )}

          {isDoc && mode === "preview" && !fullLoading && (
            <div className="prose-reader">
              {isMarkdownDoc && (content || docBody) ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                  {linkifyWikilinks(content || docBody, outgoing)}
                </ReactMarkdown>
              ) : content || docBody ? (
                <div className="whitespace-pre-wrap font-[Georgia,'Times_New_Roman',serif] text-[1.05rem] leading-[1.85]">
                  {content || docBody}
                </div>
              ) : (
                <p className="text-muted-foreground italic">No text extracted from this document.</p>
              )}
            </div>
          )}

          {/* Backlinks — items that link here via [[…]] */}
          {!fullLoading && backlinks.length > 0 && (
            <div className="not-prose mt-10 border-t border-border pt-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Linked from ({backlinks.length})
              </div>
              <ul className="space-y-1">
                {backlinks.map((b) => (
                  <li key={b.id}>
                    <button
                      onClick={() => router.push(`/directory?item=${b.id}`)}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent/50"
                    >
                      <CornerUpLeft className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate">{b.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </ScrollArea>
      <DocQueryPanel
        open={queryOpen}
        title={title}
        content={isNote ? content : isDoc ? content || docBody : articleData?.fullText ?? articleData?.excerpt ?? ""}
        onClose={() => setQueryOpen(false)}
      />
    </section>
  );
}
