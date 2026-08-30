"use client";

import * as React from "react";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { ArrowRightCircle, BookOpen, Brain, ChevronDown, ChevronLeft, ChevronRight, CornerUpLeft, ExternalLink, Eye, GraduationCap, HelpCircle, Library, Lightbulb, List, Loader2, Minimize2, MoreVertical, Pencil, Plus, Rabbit, Repeat, Sparkles, Trash2, Wand2 } from "lucide-react";
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
  autoTagItemAction,
  createNoteAction,
  deleteDirectoryItemAction,
  distillItemAction,
  searchNoteTitlesAction,
  updateNoteAction,
  type ItemSummary,
} from "@/app/(app)/directory/actions";
import { NoteEditor } from "./note-editor";
import { NoteOutline } from "./note-outline";
import { extractHeadings, toggleTaskAtLine } from "@/lib/notes/markdown";
import { editAssistAction } from "@/app/(app)/directory/ai-actions";
import type { EditAssistMode } from "@/lib/ai/edit-assist";
import { buildFlashcards } from "@/components/study/build-flashcards";
import { buildQuiz, quizReadyMessage } from "@/components/study/build-quiz";
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
  /** An ePub with bytes in the bucket — openable in the paginated reader. */
  isBook?: boolean;
  /** An ePub from before the reader existed: text only, no file to page. */
  isLegacyEpub?: boolean;
  docFullText: string | null;
  breadcrumb: { id: string; name: string }[];
  outgoingLinks?: ResolvedLink[];
  backlinks?: Backlink[];
  summary?: ItemSummary | null;
};

type ArticleContent = { fullText: string | null; excerpt: string | null; url: string };

/** ReactMarkdown hands each component the mdast node; we only need its source
 *  line, which is what anchors headings and task checkboxes back to the text. */
type MdNode = { position?: { start?: { line?: number } } };
type MdNodeProps = React.HTMLAttributes<HTMLElement> & { node?: MdNode };
type MdInputProps = React.InputHTMLAttributes<HTMLInputElement> & { node?: MdNode };

const WIKILINK_RE = /\[\[([^\]|]+?)(?:\|([^\]]+))?\]\]/g;

/**
 * Turn [[Title]] / [[Title|alias]] into markdown links the ReactMarkdown `a`
 * handler routes to ?item=<id>. Resolved → app link; missing → a
 * `#new-note:<title>` marker the renderer turns into a create-it button. The
 * target title rides in the href because the visible label may be an alias.
 */
function linkifyWikilinks(md: string, links: ResolvedLink[]): string {
  const byLower = new Map(links.map((l) => [l.title.toLowerCase(), l.id]));
  return md.replace(WIKILINK_RE, (_full, rawTitle: string, alias?: string) => {
    const title = rawTitle.trim();
    const label = (alias ?? title).trim();
    const id = byLower.get(title.toLowerCase()) ?? null;
    if (id) return `[${label}](?item=${id})`;
    return `[${label}](#new-note:${encodeURIComponent(title)})`;
  });
}

export function ItemViewer({
  item,
  onClose,
  onRequestDelete,
  startInEdit = false,
  onStartInEditConsumed,
  listCollapsed = false,
  onToggleList,
}: {
  item: DirectoryListItem | null;
  onClose: () => void;
  /** Delete this item via the shell's undo-toast flow (it also closes the
   *  viewer). When absent, falls back to a confirm-then-delete. */
  onRequestDelete?: (id: string) => void;
  /** True for a note the shell just created — focus + select the title so
   *  typing immediately replaces "Untitled note". One-shot: call
   *  onStartInEditConsumed once handled so it doesn't refire. */
  startInEdit?: boolean;
  onStartInEditConsumed?: () => void;
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
  const scrollRootRef = useRef<HTMLDivElement>(null);
  // Real elements rather than refs: child effects run before parent effects, so
  // a ref written here would still read null when NoteOutline first looks.
  const [viewportEl, setViewportEl] = useState<HTMLElement | null>(null);
  const [noteBodyEl, setNoteBodyEl] = useState<HTMLElement | null>(null);
  const [titleEl, setTitleEl] = useState<HTMLElement | null>(null);
  const [titleStuck, setTitleStuck] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [distilling, setDistilling] = useState(false);
  const [makingCards, setMakingCards] = useState(false);
  const [makingQuiz, setMakingQuiz] = useState(false);
  const [essenceOpen, setEssenceOpen] = useState(true);
  // Phone only — at sm+ the list is always shown and the header is inert.
  const [backlinksOpen, setBacklinksOpen] = useState(false);
  const lastSavedRef = useRef<{ title: string; content: string }>({ title: "", content: "" });
  // Mirrors the live editable buffer so we can flush a pending edit immediately
  // when switching items / closing / unloading — refs survive the re-render that
  // a new item triggers, so this still holds the OUTGOING item's text.
  const editBufRef = useRef<{ id: string; kind: string; title: string; content: string } | null>(null);
  // True once a note has actually been typed into this "session" (since it was
  // selected), reset per-item. Drives the auto-tag-on-finish below — once per
  // edit session, not on every keystroke or every preview/edit toggle.
  const editedRef = useRef(false);

  // AI edit-assistant (rewrite/summarize/continue) state for the note editor.
  const [selRange, setSelRange] = useState({ start: 0, end: 0 });
  const [assistBusy, setAssistBusy] = useState<EditAssistMode | null>(null);
  const assistSnapshotRef = useRef<string | null>(null);

  // Radix nests its own scrolling div inside ScrollArea; that element, not the
  // root, is the scroll container the outline observes.
  useEffect(() => {
    setViewportEl(
      scrollRootRef.current?.querySelector<HTMLElement>("[data-radix-scroll-area-viewport]") ?? null,
    );
  }, [item?.id]);

  // Slide the note title into the header once the real h1 scrolls out of view.
  useEffect(() => {
    if (!titleEl || !viewportEl) {
      setTitleStuck(false);
      return;
    }
    const io = new IntersectionObserver(([e]) => setTitleStuck(!e.isIntersecting), {
      root: viewportEl,
      threshold: 0,
    });
    io.observe(titleEl);
    return () => io.disconnect();
  }, [titleEl, viewportEl]);

  /** Backs the editor's `[[` autocomplete. */
  const searchTitles = useCallback(async (query: string) => {
    try {
      return await searchNoteTitlesAction(query);
    } catch {
      return [];
    }
  }, []);

  /** Fire-and-forget auto-tag for a note the user just finished editing.
   *  autoTagDirectoryItem already no-ops server-side if the item has tags, so
   *  this is safe to call even when nothing will actually change. */
  const maybeAutoTag = useCallback((id: string, kind: string, text: string) => {
    if (!editedRef.current) return;
    editedRef.current = false;
    if (kind !== "user_note" || text.trim().length < 80) return;
    void autoTagItemAction(id).then((r) => {
      if (r.ok && r.tags.length > 0) {
        toast.info(`Tagged: ${r.tags.map((t) => `#${t}`).join(" ")}`);
      }
    });
  }, []);

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
    editedRef.current = false;
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
      // Without this the rejection was unhandled: offline, or a dropped
      // connection, left the viewer showing an empty item with no explanation
      // and an error only the console ever saw.
      .catch(() => {
        if (!aborted) toast.error("Couldn't load this item — check your connection.");
      })
      .finally(() => !aborted && setFullLoading(false));

    return () => {
      aborted = true;
      // Switching items inside the 800ms autosave debounce would otherwise drop
      // the pending edit — flush it now.
      flushSave();
      // Leaving a note that was actually edited: auto-tag it. Covers both
      // switching to a different item and closing the panel (item → null).
      const buf = editBufRef.current;
      if (buf) maybeAutoTag(buf.id, buf.kind, buf.content);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally keyed on the item ID only; the `item` object identity churns on every parent render
  }, [item?.id, flushSave, maybeAutoTag]);

  // Flush a pending edit if the tab/window is closing.
  useEffect(() => {
    const onBeforeUnload = () => flushSave();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [flushSave]);

  // A just-created note: focus + select the title so the first keystroke
  // replaces "Untitled note" instead of requiring a click + select-all first.
  useEffect(() => {
    if (!item || !startInEdit || item.kind !== "user_note") return;
    const raf = requestAnimationFrame(() => {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    });
    onStartInEditConsumed?.();
    return () => cancelAnimationFrame(raf);
    // onStartInEditConsumed intentionally omitted: it's a fresh closure from the
    // parent every render, and including it would refire this on every render
    // rather than only when the item/flag actually change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id, startInEdit]);

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
            })
            // Best-effort enrichment: the excerpt is already on screen, so a
            // failure here costs the full text and nothing else. Swallowed
            // rather than reported — but swallowed deliberately, not by
            // leaving the rejection unhandled.
            .catch(() => {});
        }
      })
      .catch(() => {});
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
        const r = await buildFlashcards(item.id);
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
        const r = await buildQuiz([item.id]);
        if (r.ok) {
          toast.success(quizReadyMessage(r));
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

  /** A [[Wikilink]] pointing at nothing: create that note and jump to it. */
  function createMissingNote(target: string) {
    const t = target.trim();
    if (!t) return;
    startTransition(async () => {
      try {
        const r = await createNoteAction({ title: t, folderId: null });
        if (!r.ok) {
          toast.error("Couldn't create that note");
          return;
        }
        toast.success(`Created "${t}"`);
        router.push(`/directory?item=${r.itemId}`);
      } catch {
        toast.error("Couldn't create that note");
      }
    });
  }

  /** Tick a `- [ ]` straight from the rendered note. The markdown source line
   *  is the anchor, so the rest of the note is left byte-for-byte alone. */
  function toggleTask(line: number) {
    if (!item || !isNote) return;
    const next = toggleTaskAtLine(content, line);
    if (next === null) return;
    setContent(next);
    setDirty(true);
    editedRef.current = true;
    editBufRef.current = { id: item.id, kind: item.kind, title, content: next };
  }

  /** Leave edit mode, giving the note its one auto-tag pass on the way out. */
  function leaveEdit() {
    setMode("preview");
    if (item) maybeAutoTag(item.id, item.kind, content);
  }

  function runAssist(mode: EditAssistMode) {
    if (!item || assistBusy) return;
    const { start, end } = selRange;
    const selection = content.slice(start, end);
    if (mode !== "continue" && !selection.trim()) {
      toast.error("Select some text first");
      return;
    }
    setAssistBusy(mode);
    startTransition(async () => {
      try {
        const r = await editAssistAction({
          mode,
          selection,
          title,
          before: content.slice(0, start),
          after: content.slice(end),
        });
        if (!r.ok) {
          toast.error(r.error);
          return;
        }
        const snapshot = content;
        const next = content.slice(0, start) + r.text + content.slice(end);
        assistSnapshotRef.current = snapshot;
        setContent(next);
        setDirty(true);
        editedRef.current = true;
        editBufRef.current = { id: item.id, kind: item.kind, title, content: next };
        const label = mode === "rewrite" ? "Rewrote" : mode === "summarize" ? "Summarized" : "Continued";
        toast.success(label, {
          action: {
            label: "Undo",
            onClick: () => {
              const prev = assistSnapshotRef.current;
              if (prev === null) return;
              setContent(prev);
              setDirty(true);
              editBufRef.current = { id: item.id, kind: item.kind, title, content: prev };
            },
          },
        });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Couldn't run the assistant");
      } finally {
        setAssistBusy(null);
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

  // Outline anchors: keyed by source line, so the slug the outline jumps to and
  // the id the renderer emits cannot drift apart. linkifyWikilinks only ever
  // rewrites within a line, so line numbers survive it.
  const headingSlugByLine = new Map(extractHeadings(content).map((h) => [h.line, h.slug]));

  const heading = (Tag: "h1" | "h2" | "h3" | "h4") =>
    function Heading({ node, children, ...props }: MdNodeProps) {
      const slug = headingSlugByLine.get(node?.position?.start?.line ?? -1);
      return (
        <Tag id={slug} data-note-heading={slug} {...props}>
          {children}
        </Tag>
      );
    };

  // ReactMarkdown link handler: intercept wikilink hrefs and route them in-app.
  const mdComponents = {
    h1: heading("h1"),
    h2: heading("h2"),
    h3: heading("h3"),
    h4: heading("h4"),
    input: ({ type, checked, node, ...props }: MdInputProps) => {
      const line = node?.position?.start?.line;
      if (type !== "checkbox" || !isNote || !line) {
        return <input type={type} checked={checked} readOnly {...props} />;
      }
      return (
        <input
          type="checkbox"
          checked={!!checked}
          aria-label="Toggle task"
          onChange={() => toggleTask(line)}
        />
      );
    },
    a: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => {
      if (href?.startsWith("#new-note:")) {
        const target = decodeURIComponent(href.slice("#new-note:".length));
        return (
          <button
            onClick={() => createMissingNote(target)}
            title={`No note called "${target}" yet — click to create it`}
            className="inline-flex items-baseline gap-0.5 rounded bg-muted px-1 text-muted-foreground underline decoration-dotted underline-offset-2 transition-colors hover:bg-accent hover:text-foreground"
          >
            {children}
            <Plus className="h-3 w-3 self-center opacity-70" />
          </button>
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
    <section className="flex min-w-0 flex-1 flex-col overflow-hidden motion-safe:animate-page-in">
      {/* Header */}
      <div className="flex min-w-0 items-center gap-1 border-b border-border px-3 py-2">
        <Button size="sm" variant="ghost" onClick={onClose} className="lg:hidden -ml-1 gap-1 px-2">
          <ChevronLeft className="h-4 w-4" />
          Back
        </Button>
        <PaneToggles listCollapsed={listCollapsed} onToggleList={onToggleList} className="-ml-1 mr-0.5" />
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
          {titleStuck && title ? (
            <span className="truncate font-sans text-sm normal-case tracking-normal text-foreground">
              {title}
            </span>
          ) : (
            <span className="truncate">{item.kind.replace("_", " ")}</span>
          )}
          <span className="hidden sm:inline">·</span>
          <span className="hidden sm:inline">{formatRelativeTime(item.updatedAt)}</span>
          {saving ? (
            <span className="hidden italic sm:inline">· Saving…</span>
          ) : dirty ? (
            <span className="hidden italic sm:inline">· unsaved</span>
          ) : (
            (isNote || isDoc) && <span className="hidden italic text-muted-foreground/70 sm:inline">· Saved</span>
          )}
        </div>

        {(isNote || isDoc) && (
          <div
            className={cn(
              "shrink-0 items-center rounded-md border border-border p-0.5",
              isNote ? "hidden sm:flex" : "flex",
            )}
          >
            <button
              onClick={() => setMode("edit")}
              className={cn(
                "rounded px-2 py-0.5 text-xs transition-colors",
                mode === "edit"
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Pencil className="mr-1 hidden h-3 w-3 sm:inline" /> Edit
            </button>
            <button
              onClick={leaveEdit}
              className={cn(
                "rounded px-2 py-0.5 text-xs transition-colors",
                mode === "preview"
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Eye className="mr-1 hidden h-3 w-3 sm:inline" /> Preview
            </button>
          </div>
        )}

        {/* Outline: a rail at xl+, a dropdown everywhere below that. */}
        {isNote && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" title="Outline" className="xl:hidden">
                <List className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="p-0">
              <NoteOutline
                content={content}
                mode={mode}
                bodyEl={noteBodyEl}
                scrollEl={viewportEl}
                variant="panel"
              />
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {isArticle && (articleData?.url ?? full?.sourceUrl) && (
          <Button size="icon" variant="ghost" asChild title="Open original">
            <a href={articleData?.url ?? full?.sourceUrl ?? "#"} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4" />
            </a>
          </Button>
        )}

        <Button
          size="icon"
          variant="ghost"
          onClick={() => setQueryOpen((v) => !v)}
          title="Ask about this item"
          className={cn("hidden sm:inline-flex", queryOpen && "text-primary")}
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
            <DropdownMenuItem className="sm:hidden" onClick={() => setQueryOpen((v) => !v)}>
              <Sparkles className="mr-2 h-3.5 w-3.5" /> Ask about this item
            </DropdownMenuItem>
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

      <div className="flex min-h-0 min-w-0 flex-1">
      <ScrollArea ref={scrollRootRef} className="min-w-0 flex-1">
        <div
          ref={bodyRef}
          className={cn(
            "mx-auto w-full break-words px-4 py-6 sm:px-6 sm:py-8",
            isNote ? "max-w-[72ch] pb-28 sm:pb-8" : "max-w-[68ch]",
          )}
        >
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
              ref={titleInputRef}
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setDirty(true);
                if (item.kind === "user_note") editedRef.current = true;
                editBufRef.current = { id: item.id, kind: item.kind, title: e.target.value, content };
              }}
              className="editorial-display border-0 px-0 text-2xl font-bold tracking-tight shadow-none focus-visible:ring-0 sm:text-3xl"
              placeholder="Title"
            />
          ) : (
            <h1
              ref={setTitleEl}
              className="editorial-display break-words text-2xl font-bold tracking-tight sm:text-3xl"
            >
              {title}
            </h1>
          )}

          <Separator className="my-4 sm:my-6" />

          {/* A book opens in its own full-screen reader; the text below stays
              as it is, because Ask, Distill and search all work off it. */}
          {full?.isBook && full.documentId && (
            <div className="not-prose mb-6 flex flex-wrap items-center gap-3">
              <Button onClick={() => router.push(`/read/${full.documentId}`)} className="gap-2">
                <BookOpen className="h-4 w-4" />
                Read book
              </Button>
              <span className="text-xs text-muted-foreground">
                Picks up where you left off.
              </span>
            </div>
          )}

          {full?.isLegacyEpub && (
            <p className="not-prose mb-6 rounded-md border border-border p-3 text-xs leading-relaxed text-muted-foreground">
              This ePub was uploaded before the reader existed, so only its text was kept — the
              file itself wasn&apos;t stored. Upload it again to read it as a book.
            </p>
          )}

          {/* Body */}
          {fullLoading && !isNote && (
            <div className="space-y-3">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
            </div>
          )}

          {isNote && mode === "edit" && (
            <>
              <div className="not-prose -mx-4 mb-2 flex items-center gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:overflow-visible sm:px-0 sm:pb-0 [&::-webkit-scrollbar]:hidden">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 shrink-0 gap-1.5 px-2 text-xs"
                  onClick={() => runAssist("rewrite")}
                  disabled={assistBusy !== null}
                  title="Rewrite the selected text"
                >
                  {assistBusy === "rewrite" ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Repeat className="h-3 w-3" />
                  )}
                  Rewrite
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 shrink-0 gap-1.5 px-2 text-xs"
                  onClick={() => runAssist("summarize")}
                  disabled={assistBusy !== null}
                  title="Summarize the selected text"
                >
                  {assistBusy === "summarize" ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Minimize2 className="h-3 w-3" />
                  )}
                  Summarize
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 shrink-0 gap-1.5 px-2 text-xs"
                  onClick={() => runAssist("continue")}
                  disabled={assistBusy !== null}
                  title="Continue writing from the cursor"
                >
                  {assistBusy === "continue" ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <ArrowRightCircle className="h-3 w-3" />
                  )}
                  Continue
                </Button>
              </div>
              <div ref={setNoteBodyEl} className="min-h-[60vh]">
                <NoteEditor
                  value={content}
                  onChange={(next) => {
                    setContent(next);
                    setDirty(true);
                    editedRef.current = true;
                    editBufRef.current = { id: item.id, kind: item.kind, title, content: next };
                  }}
                  onSelectionChange={setSelRange}
                  searchTitles={searchTitles}
                  onDone={leaveEdit}
                  placeholder={"Start writing…  ⌘B bold · ⌘I italic · ⌘K link · [[ to link a note"}
                />
              </div>
            </>
          )}

          {isNote && mode === "preview" && (
            <div ref={setNoteBodyEl} className="prose-note">
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
              ) : !full?.articleId && full?.content ? (
                // A URL saved directly (not via an RSS feed article) — the
                // extracted text has no HTML/markdown structure, so render it
                // as plain preformatted text rather than through the Markdown
                // renderer (which would misread stray *, _, # in the prose).
                <div className="whitespace-pre-wrap break-words">{full.content}</div>
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
                <div className="whitespace-pre-wrap break-words font-[Georgia,'Times_New_Roman',serif] text-[1.05rem] leading-[1.85]">
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
              <button
                onClick={() => setBacklinksOpen((v) => !v)}
                className="mb-2 flex w-full items-center gap-1.5 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground sm:pointer-events-none"
              >
                Linked from ({backlinks.length})
                <ChevronDown
                  className={cn("h-3.5 w-3.5 transition-transform sm:hidden", !backlinksOpen && "-rotate-90")}
                />
              </button>
              <ul className={cn("space-y-1", !backlinksOpen && "hidden sm:block")}>
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
      {isNote && (
        <NoteOutline
          content={content}
          mode={mode}
          bodyEl={noteBodyEl}
          scrollEl={viewportEl}
          variant="rail"
          className="hidden xl:flex"
        />
      )}
      </div>

      {/* Phone: the mode switch lives where a thumb actually reaches. It sits
          below the formatting bar, which takes over while the keyboard is up. */}
      {isNote && (
        <button
          onClick={() => (mode === "edit" ? leaveEdit() : setMode("edit"))}
          title={mode === "edit" ? "Preview" : "Edit"}
          aria-label={mode === "edit" ? "Preview" : "Edit"}
          className="fixed right-4 z-30 flex h-12 w-12 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-lg active:bg-accent sm:hidden"
          style={{ bottom: "calc(4.25rem + env(safe-area-inset-bottom))" }}
        >
          {mode === "edit" ? <Eye className="h-5 w-5" /> : <Pencil className="h-5 w-5" />}
        </button>
      )}

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
