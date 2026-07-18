import {
  BookOpen,
  Brain,
  FileText,
  GraduationCap,
  Layers,
  Library,
  ListChecks,
  MessageCircle,
  Network,
  Rabbit,
  Rss,
  Search,
  Settings as SettingsIcon,
  Sparkles,
  Tag,
  type LucideIcon,
} from "lucide-react";

/**
 * The feature reference shown on /guide (and the source of truth for the
 * app's teaching copy). Plain data — no JSX — so it can be imported anywhere.
 * Keep entries short and plain-language.
 */
export type GuideSection = {
  id: string;
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  what: string; // one line: what it is
  why: string; // one line: why it helps
  how: string; // one line: how to use it
  href?: string; // deep link into the feature (for logged-in readers)
};

/** The app's core loop — shown up top as the mental model. */
export const CORE_LOOP: { step: string; label: string; blurb: string; icon: LucideIcon }[] = [
  { step: "1", label: "Capture", icon: Sparkles, blurb: "Save articles, upload docs, jot notes — everything lands in one inbox." },
  { step: "2", label: "Organize", icon: Layers, blurb: "Sort into folders and tags so your library stays findable." },
  { step: "3", label: "Distill", icon: Brain, blurb: "Pull out the essence — summaries and flashcards you'll actually remember." },
  { step: "4", label: "Express", icon: MessageCircle, blurb: "Ask questions, connect ideas, and put what you know to work." },
];

export const GUIDE_SECTIONS: GuideSection[] = [
  {
    id: "today",
    icon: Sparkles,
    eyebrow: "Start of day",
    title: "Today — your Daily Brief",
    what: "An AI-triaged dashboard of your unread articles.",
    why: "Skip the firehose: see what's worth reading now, themes to skim, and what to skip.",
    how: "Open Today. Tap an item to read it, or bookmark it into your library.",
    href: "/today",
  },
  {
    id: "feeds",
    icon: Rss,
    eyebrow: "Read",
    title: "Feeds — your RSS reader",
    what: "Subscribe to sites and blogs; read them distraction-free.",
    why: "One calm place for everything you follow, organized into folders.",
    how: "Add a feed, star favourites, save to Read Later, or bookmark the best into your Directory.",
    href: "/feeds",
  },
  {
    id: "directory",
    icon: Library,
    eyebrow: "Organize",
    title: "Directory — your permanent library",
    what: "Every saved article, note, and document, in folders and tags.",
    why: "Your durable knowledge base — a reading board with limits keeps you focused.",
    how: "Drag items between folders, tag them, and hit Distill to pin an AI summary or make flashcards.",
    href: "/directory",
  },
  {
    id: "documents",
    icon: FileText,
    eyebrow: "Import",
    title: "Documents — bring your own files",
    what: "Upload PDFs and documents to read and search alongside everything else.",
    why: "Your files become first-class, searchable, ask-able knowledge.",
    how: "Upload in the Directory; open a document to read, highlight, and dig in.",
    href: "/documents",
  },
  {
    id: "study",
    icon: GraduationCap,
    eyebrow: "Grow",
    title: "Study — learning that levels you up",
    what: "XP, skills, and a daily streak earned from reading, reviewing, and distilling.",
    why: "Turns steady learning into visible progress you'll want to keep.",
    how: "Open Study to see your stats, skills, and what's due today.",
    href: "/study",
  },
  {
    id: "review",
    icon: Brain,
    eyebrow: "Remember",
    title: "Review — spaced repetition",
    what: "Flashcards resurfaced exactly when you're about to forget them.",
    why: "The most efficient way to move facts into long-term memory.",
    how: "Make cards from any item's key points, then review what's due each day.",
    href: "/review",
  },
  {
    id: "ask",
    icon: MessageCircle,
    eyebrow: "Express",
    title: "Ask — chat with your knowledge",
    what: "Plain-language answers grounded in your own library, with citations.",
    why: "Get answers from what you've actually read — not a generic model.",
    how: "Ask a question; follow the numbered citations back to the source. Turn on web search to fill gaps.",
    href: "/ask",
  },
  {
    id: "rabbithole",
    icon: Rabbit,
    eyebrow: "Explore",
    title: "Rabbithole — dig into anything",
    what: "Highlight any passage and ask about it; the answer becomes a document you can dig into again.",
    why: "Follow your curiosity as deep as you like — every branch is saved.",
    how: "Open a hole, select text (tap-and-hold on mobile), pick a lens or ask your own question.",
    href: "/rabbithole",
  },
  {
    id: "map",
    icon: Network,
    eyebrow: "See connections",
    title: "Knowledge Map",
    what: "A living graph of your items, folders, and tags.",
    why: "See the shape of what you know and spot links you'd miss in a list.",
    how: "Open the Map, click any node for detail, or focus its local neighbourhood.",
    href: "/map",
  },
  {
    id: "tags",
    icon: Tag,
    eyebrow: "Filter",
    title: "Tags",
    what: "Cross-cutting labels that group items across folders.",
    why: "Slice your library by theme, not just where you filed it.",
    how: "Tag items anywhere; browse and filter by tag from Tags or the sidebar.",
    href: "/tags",
  },
  {
    id: "tasks",
    icon: ListChecks,
    eyebrow: "Do",
    title: "Tasks",
    what: "Checkboxes written in your notes, gathered into one list.",
    why: "Action items never get lost inside a long note.",
    how: "Write `- [ ] something` in any note; check it off from Tasks.",
    href: "/tasks",
  },
  {
    id: "search",
    icon: Search,
    eyebrow: "Find",
    title: "Search & command palette",
    what: "Instant search across everything, plus quick actions.",
    why: "Jump anywhere and do anything without leaving the keyboard.",
    how: "Press ⌘K (Ctrl K) to open it from any screen.",
  },
  {
    id: "settings",
    icon: SettingsIcon,
    eyebrow: "Make it yours",
    title: "Settings",
    what: "Theme, colour palette, fonts, text size, and study preferences.",
    why: "Tune the reading experience and how AI generates flashcards and quizzes.",
    how: "Open Settings to switch light/dark, pick a palette, or replay this tour.",
    href: "/settings",
  },
];

export type Shortcut = { keys: string[]; label: string };
export const SHORTCUTS: Shortcut[] = [
  { keys: ["⌘K", "Ctrl K"], label: "Open search & command palette" },
  { keys: ["c"], label: "Quick-capture a note" },
  { keys: ["g", "then a letter"], label: "Jump between sections" },
  { keys: ["?"], label: "Show all keyboard shortcuts" },
];

export const GUIDE_ICON = BookOpen;
