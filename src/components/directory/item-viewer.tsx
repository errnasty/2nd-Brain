"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ExternalLink, Eye, Pencil, Trash2, X } from "lucide-react";
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

type ArticleContent = { fullText: string | null; excerpt: string | null; url: string };
type DocumentContent = { fullText: string | null };

export function ItemViewer({
  item,
  initialTags,
  onClose,
}: {
  item: DirectoryListItem | null;
  initialTags: string[];
  onClose: () => void;
}) {
  const [, startTransition] = useTransition();
  const [mode, setMode] = useState<"preview" | "edit">("preview");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [articleData, setArticleData] = useState<ArticleContent | null>(null);
  const [docData, setDocData] = useState<DocumentContent | null>(null);
  const [externalLoading, setExternalLoading] = useState(false);
  const lastSavedRef = useRef<{ title: string; content: string }>({ title: "", content: "" });

  // Hydrate from item
  useEffect(() => {
    if (!item) return;
    setTitle(item.title);
    setContent(item.content ?? "");
    setDirty(false);
    setMode(item.kind === "user_note" ? "edit" : "preview");
    lastSavedRef.current = { title: item.title, content: item.content ?? "" };
    setArticleData(null);
    setDocData(null);

    // Fetch external content for saved articles / uploaded docs
    if (item.kind === "saved_article" && item.articleId) {
      let aborted = false;
      setExternalLoading(true);
      fetch(`/api/articles/${item.articleId}`, { cache: "no-store" })
        .then(async (res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (aborted || !data) return;
          setArticleData({
            fullText: data.fullText ?? null,
            excerpt: data.excerpt ?? null,
            url: data.url,
          });
          // Trigger extraction if missing
          if (!data.fullText) {
            fetch(`/api/articles/${item.articleId}/full-text`, { method: "POST" })
              .then((r) => (r.ok ? r.json() : null))
              .then((res) => {
                if (aborted || !res?.content) return;
                setArticleData((prev) => (prev ? { ...prev, fullText: res.content } : prev));
              });
          }
        })
        .finally(() => !aborted && setExternalLoading(false));
      return () => {
        aborted = true;
      };
    }

    if (item.kind === "uploaded_document" && item.documentId) {
      // Document content already pasted into directory_items.content (first 10k chars).
      // For full content, we could fetch from /api/documents/:id later if needed.
      setDocData({ fullText: item.content });
    }
  }, [item?.id]);

  // Debounced save for notes
  useEffect(() => {
    if (!item || item.kind !== "user_note") return;
    if (!dirty) return;
    const handle = setTimeout(() => {
      const t = title.trim() || "Untitled note";
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

  return (
    <section className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-1 border-b border-border px-3 py-2">
        <Button size="icon" variant="ghost" onClick={onClose} className="lg:hidden">
          <X className="h-4 w-4" />
        </Button>
        <div className="flex flex-1 items-center gap-2 text-xs text-muted-foreground">
          <span className="capitalize">{item.kind.replace("_", " ")}</span>
          <span>·</span>
          <span>{formatRelativeTime(item.updatedAt)}</span>
          {dirty && <span className="italic">· unsaved</span>}
        </div>

        {isNote && (
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

        <Button size="icon" variant="ghost" onClick={handleDelete} title="Delete">
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="mx-auto max-w-[68ch] px-6 py-8">
          {/* Title */}
          {isNote && mode === "edit" ? (
            <Input
              value={title}
              onChange={(e) => { setTitle(e.target.value); setDirty(true); }}
              className="border-0 px-0 text-2xl font-bold tracking-tight shadow-none focus-visible:ring-0"
              placeholder="Title"
            />
          ) : (
            <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          )}

          {/* Tags */}
          {initialTags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {initialTags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center rounded-full bg-accent px-2.5 py-0.5 text-[11px] font-medium text-accent-foreground"
                >
                  #{tag}
                </span>
              ))}
            </div>
          )}

          <Separator className="my-6" />

          {/* Body */}
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
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
              ) : (
                <p className="text-muted-foreground italic">Empty note. Switch to Edit to write.</p>
              )}
            </div>
          )}

          {isArticle && (
            <div className="prose-reader">
              {externalLoading && !articleData ? (
                <div className="space-y-3">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-5/6" />
                </div>
              ) : articleData?.fullText ? (
                <div dangerouslySetInnerHTML={{ __html: articleData.fullText }} />
              ) : articleData?.excerpt ? (
                <p>{articleData.excerpt}</p>
              ) : (
                <p className="text-muted-foreground italic">Article body not available.</p>
              )}
            </div>
          )}

          {isDoc && (
            <div className="prose-reader">
              {docData?.fullText ? (
                <div className="whitespace-pre-wrap font-[Georgia,'Times_New_Roman',serif] text-[1.05rem] leading-[1.85]">
                  {docData.fullText}
                </div>
              ) : (
                <p className="text-muted-foreground italic">No text extracted from this document.</p>
              )}
            </div>
          )}
        </div>
      </ScrollArea>
    </section>
  );
}
