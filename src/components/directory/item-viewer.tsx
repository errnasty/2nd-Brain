"use client";

import * as React from "react";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Brain, ChevronDown, ChevronLeft, ChevronRight, CornerUpLeft, ExternalLink, Eye, GraduationCap, HelpCircle, Library, Lightbulb, Loader2, MoreVertical, Pencil, Rabbit, Sparkles, Trash2, Wand2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { Markdown } from "@/components/ui/markdown";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn, formatRelativeTime } from "@/lib/utils";
import {
  deleteDirectoryItemAction,
  distillItemAction,
  updateNoteAction,
  type ItemSummary,
} from "@/app/(app)/directory/actions";
import { generateFlashcardsAction } from "@/app/(app)/review/actions";
import { generateQuizAction } from "@/app/(app)/study/quiz-actions";
import { celebrate } from "@/lib/gamify/celebrate";
import { useConfirm } from "@/components/ui/app-dialogs";
import { toast } from "sonner";
import type { DirectoryListItem } from "./directory-shell";
import { DocQueryPanel } from "@/components/reader/doc-query-panel";
import { ConnectionsPanel } from "@/components/reader/connections-panel";
import { Rabbithole } from "@/components/reader/rabbithole";
import { PaneToggles } from "@/components/shell/pane-toggles";

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
  summary?: ItemSummary | null;
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
  onRequestDelete,
  listCollapsed = false,
  onToggleList,
}: {
  item: DirectoryListItem | null;
  onClose: () => void;
  /** Delete this item via the shell's undo-toast flow (it also closes the
   *  viewer). When absent, falls back to a confirm-then-delete. */
  onRequestDelete?: (id: string) => void;
  /** Whether the Directory list (third bar) is collapsed. */
  listCollapsed?: boolean;
  /** Toggle the Directory list open/closed (desktop). */
  onToggleList?: () => void;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [, startTransition] = useTransition();
  const [mode, setMode] = useState<"preview" | "edit">("preview");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [full, setFull] = useState<FullItem | null>(null);
  const [fullLoading, setFullLoading] = useState(false);
  const [articleData, setArticleData] = useState<ArticleContent | null>(null);
  const [queryOpen, setQueryOpen] = useState(false);
  const [rabbitholeOpen, setRabbitholeOpen] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);
  const [distilling, setDistilling] = useState(false);
  const [makingCards, setMakingCards] = useState(false);
  const [makingQuiz, setMakingQuiz] = useState(false);
  const [essenceOpen, setEssenceOpen] = useState(true);
  const lastSavedRef = useRef<{ title: string; content: string }>({ title: "", content: "" });
  // Mirrors the live editable buffer so we can flush a pending edit immediately
  // when switching items / closing / unloading — refs survive the re-render that
  // a new item triggers, so this still holds the OUTGOING item's text.
  const editBufRef = useRef<{ id: string; kind: string; title: string; content: string } | null>(null);

  const flushSave = useCallback(() => {
    const b = editBufRef.current;
    if (!b || !b.id) return;
    if (b.kind !== "user_note" && b.kind !== "uploaded_document") return;
    const t = b.title.trim() || (b.kind === "user_note" ? "Untitled note" : "Untitled");
    if (t === lastSavedRef.current.title && b.content === lastSavedRef.current.content) return;
    const id = b.id;
    const content = b.content;
    setSaving(true);
    void updateNoteAction({ id, title: t, content })
      .then((r) => {
        if (r.ok) lastSavedRef.current = { title: t, content };
      })
      .catch(() => {})
      .finally(() => setSaving(false));
  }, []);

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
    setRabbitholeOpen(false);
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
          editBufRef.current = { id: data.id, kind: data.kind, title: data.title, content: data.content ?? "" };
        } else if (data.kind === "uploaded_document") {
          // Seed the editor from the FULL doc text (not the truncated preview).
          const body = data.docFullText ?? data.content ?? "";
          setContent(body);
          lastSavedRef.current = { title: data.title, content: body };
          editBufRef.current = { id: data.id, kind: data.kind, title: data.title, content: body };
        }
      })
      .finally(() => !aborted && setFullLoading(false));

    return () => {
      aborted = true;
      // Switching items inside the 800ms autosave debounce would otherwise drop
      // the pending edit — flush it now.
      flushSave();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally keyed on the item ID only; the `item` object identity churns on every parent render
  }, [item?.id, flushSave]);

  // Flush a pending edit if the tab/window is closing.
  useEffect(() => {
    const onBeforeUnload = () => flushSave();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [flushSave]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refetch only when the resolved item identity changes, not on every `full` object recreation
  }, [full?.id, full?.kind, full?.articleId]);

  // Debounced autosave for editable items (notes + uploaded documents).
  useEffect(() => {
    if (!item || (item.kind !== "user_note" && item.kind !== "uploaded_document")) return;
    if (!dirty) return;
    const handle = setTimeout(() => {
      const t = title.trim() || (item.kind === "user_note" ? "Untitled note" : "Untitled");
      const c = content;
      if (t === lastSavedRef.current.title && c === lastSavedRef.current.content) {
        setDirty(false);
        return;
      }
      setSaving(true);
      startTransition(async () => {
        const r = await updateNoteAction({ id: item.id, title: t, content: c });
        if (r.ok) {
          lastSavedRef.current = { title: t, content: c };
          editBufRef.current = { id: item.id, kind: item.kind, title: t, content: c };
          setDirty(false);
        }
        setSaving(false);
      });
    }, 800);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- autosave debounce re-arms on edited fields + item identity; adding `item` would reset the timer on unrelated renders
  }, [title, content, dirty, item?.id, item?.kind]);

  async function handleDelete() {
    if (!item) return;
    // Preferred path: hand off to the shell's undo-toast delete (no confirm
    // dialog — the 6s Undo IS the safety net). It closes the viewer for us.
    if (onRequestDelete) {
      onRequestDelete(item.id);
      return;
    }
    // Fallback (viewer used without the shell handler): keep the confirm.
    const ok = await confirm({
      title: `Delete "${item.title}"?`,
      body: "This cannot be undone.",
      destructive: true,
      confirmLabel: "Delete",
    });
    if (!ok) return;
    startTransition(async () => {
      try {
        await deleteDirectoryItemAction(item.id);
        toast.success("Item deleted");
        onClose();
      } catch (err) {
        toast.error(`Delete failed: ${err instanceof Error ? err.message : "unknown error"}`);
      }
    });
  }

  function runDistill() {
    if (!item || distilling) return;
    setDistilling(true);
    setEssenceOpen(true);
    startTransition(async () => {
      try {
        const r = await distillItemAction(item.id);
        if (r.ok) {
          setFull((f) => (f && f.id === item.id ? { ...f, summary: r.summary } : f));
          toast.success("Distilled the essence");
          celebrate(r.xp);
        } else {
          toast.error(r.error);
        }
      } catch (err) {
        toast.error(`Distill failed: ${err instanceof Error ? err.message : "unknown error"}`);
      } finally {
        setDistilling(false);
      }
    });
  }

  function runMakeFlashcards() {
    if (!item || makingCards) return;
    setMakingCards(true);
    startTransition(async () => {
      try {
        const r = await generateFlashcardsAction(item.id);
        if (r.ok) {
          toast.success(`Made ${r.count} flashcard${r.count === 1 ? "" : "s"}`);
          celebrate(r.xp);
        } else {
          toast.error(r.error);
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Couldn't generate flashcards");
      } finally {
        setMakingCards(false);
      }
    });
  }

  function runMakeQuiz() {
    if (!item || makingQuiz) return;
    setMakingQuiz(true);
    startTransition(async () => {
      try {
        const r = await generateQuizAction([item.id]);
        if (r.ok) {
          toast.success(`Quiz ready — ${r.count} question${r.count === 1 ? "" : "s"}`);
          celebrate(r.xp);
          router.push(`/study?tab=quiz&quiz=${r.id}`);
        } else {
          toast.error(r.error);
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Couldn't generate a quiz");
      } finally {
        setMakingQuiz(false);
      }
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
        <PaneToggles listCollapsed={listCollapsed} onToggleList={onToggleList} className="-ml-1 mr-0.5" />
        <div className="flex flex-1 items-center gap-2 font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
          <span>{item.kind.replace("_", " ")}</span>
          <span>·</span>
          <span>{formatRelativeTime(item.updatedAt)}</span>
          {saving ? (
            <span className="italic">· Saving…</span>
          ) : dirty ? (
            <span className="italic">· unsaved</span>
          ) : (
            (isNote || isDoc) && <span className="italic text-muted-foreground/70">· Saved</span>
          )}
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

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon" variant="ghost" title="More actions">
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setRabbitholeOpen((v) => !v)}>
              <Rabbit className="mr-2 h-3.5 w-3.5" /> Rabbithole
            </DropdownMenuItem>
            <DropdownMenuItem onClick={runDistill} disabled={distilling}>
              {distilling ? (
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Wand2 className="mr-2 h-3.5 w-3.5" />
              )}
              {full?.summary ? "Re-distill the essence" : "Distill the essence"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={runMakeFlashcards} disabled={makingCards}>
              {makingCards ? (
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Brain className="mr-2 h-3.5 w-3.5" />
              )}
              Make flashcards
            </DropdownMenuItem>
            <DropdownMenuItem onClick={runMakeQuiz} disabled={makingQuiz}>
              {makingQuiz ? (
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              ) : (
                <HelpCircle className="mr-2 h-3.5 w-3.5" />
              )}
              Make quiz
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => router.push(`/study?tab=review&item=${item.id}`)}>
              <GraduationCap className="mr-2 h-3.5 w-3.5" /> Study this note
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleDelete} className="text-destructive focus:text-destructive">
              <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <ScrollArea className="flex-1">
        <div ref={bodyRef} className="mx-auto max-w-[68ch] px-6 py-8">
          {/* Breadcrumb */}
          {full && (
            <nav
              aria-label="Folder path"
              className="not-prose mb-3 flex flex-wrap items-center gap-1 font-mono text-[11px] uppercase tracking-wide text-muted-foreground"
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

          {/* Essence — pinned distilled summary (Second Brain "Distill"). */}
          {full?.summary && (
            <div className="not-prose mb-5 rounded-lg border p-3" style={{ borderColor: "hsl(var(--brand) / 0.3)", background: "hsl(var(--brand) / 0.05)" }}>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setEssenceOpen((v) => !v)}
                  className="editorial-eyebrow-brand flex flex-1 items-center gap-1.5 text-left"
                >
                  <Lightbulb className="h-3.5 w-3.5" />
                  Essence
                  <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", !essenceOpen && "-rotate-90")} />
                </button>
                <button
                  onClick={runDistill}
                  disabled={distilling}
                  title="Re-distill"
                  className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  {distilling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
                </button>
              </div>
              {essenceOpen && (
                <div className="mt-2 space-y-2">
                  <p className="text-sm font-medium leading-snug">{full.summary.tldr}</p>
                  {full.summary.keyPoints.length > 0 && (
                    <ul className="list-disc space-y-1 pl-5 text-[13px] leading-relaxed text-foreground/90">
                      {full.summary.keyPoints.map((k, i) => (
                        <li key={i}>{k}</li>
                      ))}
                    </ul>
                  )}
                  <button
                    onClick={runMakeFlashcards}
                    disabled={makingCards}
                    className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-60"
                  >
                    {makingCards ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Brain className="h-3.5 w-3.5" />
                    )}
                    Make flashcards
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Title */}
          {(isNote || isDoc) && mode === "edit" ? (
            <Input
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setDirty(true);
                editBufRef.current = { id: item.id, kind: item.kind, title: e.target.value, content };
              }}
              className="editorial-display border-0 px-0 text-3xl font-bold tracking-tight shadow-none focus-visible:ring-0"
              placeholder="Title"
            />
          ) : (
            <h1 className="editorial-display text-3xl font-bold tracking-tight">{title}</h1>
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
              onChange={(e) => {
                setContent(e.target.value);
                setDirty(true);
                editBufRef.current = { id: item.id, kind: item.kind, title, content: e.target.value };
              }}
              placeholder={"Start writing your note in Markdown…\n\n# Heading\n\nA list:\n- item one\n- item two\n\nLinks, **bold**, _italic_, `code`, all work."}
              className="min-h-[60vh] resize-none border-0 px-0 text-[1.05rem] leading-[1.85] shadow-none focus-visible:ring-0"
            />
          )}

          {isNote && mode === "preview" && (
            <div className="prose-reader">
              {content.trim() ? (
                <Markdown components={mdComponents}>
                  {linkifyWikilinks(content, outgoing)}
                </Markdown>
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
              onChange={(e) => {
                setContent(e.target.value);
                setDirty(true);
                editBufRef.current = { id: item.id, kind: item.kind, title, content: e.target.value };
              }}
              placeholder="Document text… edits re-index this document for Ask."
              className="min-h-[60vh] resize-none border-0 px-0 text-[1.05rem] leading-[1.85] shadow-none focus-visible:ring-0"
            />
          )}

          {isDoc && mode === "preview" && !fullLoading && (
            <div className="prose-reader">
              {isMarkdownDoc && (content || docBody) ? (
                <Markdown components={mdComponents}>
                  {linkifyWikilinks(content || docBody, outgoing)}
                </Markdown>
              ) : content || docBody ? (
                <div className="whitespace-pre-wrap font-[Georgia,'Times_New_Roman',serif] text-[1.05rem] leading-[1.85]">
                  {content || docBody}
                </div>
              ) : (
                <p className="text-muted-foreground italic">No text extracted from this document.</p>
              )}
            </div>
          )}

          {/* Implicit connections + tensions (opt-in) */}
          {!fullLoading && <ConnectionsPanel itemId={item.id} />}

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
        docId={item.id}
        title={title}
        content={isNote ? content : isDoc ? content || docBody : articleData?.fullText ?? articleData?.excerpt ?? ""}
        onClose={() => setQueryOpen(false)}
      />
      <Rabbithole
        itemId={item.id}
        rootTitle={title}
        bodyRef={bodyRef}
        enabled={!fullLoading}
        open={rabbitholeOpen}
        onOpenChange={setRabbitholeOpen}
      />
    </section>
  );
}
