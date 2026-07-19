/**
 * User-facing changelog — the single source of truth the app reads to show the
 * "What's New" modal. Entries are newest-first; `id` is a sortable date string.
 *
 * AGENTS/DEVELOPERS: before committing a user-facing change (a new feature, a
 * visible behavior/UX change, or a notable fix), PREPEND an entry here in plain
 * language — no file paths, no code. `LATEST_CHANGELOG_ID` drives the per-user
 * "unseen" watermark, so a new top entry is what users get notified about.
 * Purely internal work (refactors, tests, infra, deps) can be skipped.
 */

export type ChangelogTag = "feature" | "improvement" | "fix";

export type ChangelogEntry = {
  /** Sortable, unique id. Use the date the change shipped: "YYYY-MM-DD". */
  id: string;
  /** Human display date, e.g. "July 13, 2026". */
  date: string;
  /** Short user-facing headline. */
  title: string;
  tag: ChangelogTag;
  /** One or two plain-language sentences. No code or file references. */
  summary: string;
  /** Optional finer-grained bullets. */
  items?: string[];
};

export const CHANGELOG: ChangelogEntry[] = [
  {
    id: "2026-07-18-i",
    date: "July 18, 2026",
    title: "Curriculum and research now build reliably in the background",
    tag: "improvement",
    summary:
      "Building a curriculum or researching a knowledge gap now runs as a tracked background job, the same way ThinkTank decks do. The app watches the job and takes you to the finished note when it lands — you can even close the dialog and the note still arrives in your Directory.",
    items: [
      "Long curriculum and research jobs can't show false errors anymore, no matter how long they take.",
      "Closing the dialog no longer risks losing the result — it finishes in the background.",
      "If a job genuinely fails, you get the real reason.",
    ],
  },
  {
    id: "2026-07-18-h",
    date: "July 18, 2026",
    title: "Snappier pages, and long AI jobs never cry wolf",
    tag: "improvement",
    summary:
      "Pages fetch their data more efficiently — duplicate lookups are gone and independent ones run at the same time — so switching sections feels quicker, especially with several people using the app. And every long-running AI job (curriculum, gap research, saving a slow web page, flashcards) now says \"still working\" instead of showing a false error when it takes a while.",
    items: [
      "The app shell, Today, and Settings load with fewer, parallel database reads.",
      "Curriculum building, gap research, and page saving no longer show an error just because they took long — the result still arrives in your Directory.",
    ],
  },
  {
    id: "2026-07-18-g",
    date: "July 18, 2026",
    title: "ThinkTank decks build reliably — and check their facts",
    tag: "improvement",
    summary:
      "Building a deck no longer shows an error while the deck quietly finishes in the background — you now land on a live progress screen that flips into the reader the moment the cards are ready. And the AI now verifies facts with a quick web search while writing, so cards cite real sources you can open.",
    items: [
      "No more false errors on long generations; the app waits and updates itself.",
      "Cards now show their sources — links from the web and from your own library.",
      "If a build genuinely fails, you get a clear retry button instead of a dead deck.",
      "Making flashcards no longer alarms you if it takes a moment — they arrive in Study either way.",
    ],
  },
  {
    id: "2026-07-18-f",
    date: "July 18, 2026",
    title: "ThinkTank: learn any topic in bite-sized idea cards",
    tag: "feature",
    summary:
      "A new tab for learning. Type any topic — or tap a suggestion drawn from your interests — and the AI builds a swipeable deck of short idea cards, ordered from the basics to the advanced stuff and connected to what's already in your library.",
    items: [
      "Each deck is 8–12 cards, one big idea each, readable in under a minute apiece.",
      "Cards cite related notes and articles you've already saved.",
      "Save any card to your library, turn it into flashcards for review, or go deeper in Rabbithole.",
      "Finish a deck and build a full curriculum note in one tap.",
      "Your reading position is remembered, so decks work in short sittings.",
      "Find it in the sidebar, the More menu on mobile, or jump with g then k.",
    ],
  },
  {
    id: "2026-07-18-e",
    date: "July 18, 2026",
    title: "The app now gets to know you",
    tag: "feature",
    summary:
      "The welcome tour now asks your name, what you want to learn, and your preferred look — and the app uses it: the daily brief greets you by name, your interests power upcoming topic suggestions, and your chosen palette applies right away. Everything is editable later in Settings.",
    items: [
      "New-user intro asks for your name, learning interests, and favorite color palette.",
      "Today's brief and the sidebar greet you by your chosen name.",
      "A new Profile section in Settings lets you change your name and interests anytime.",
      "The tour now remembers you finished it across all your devices.",
    ],
  },
  {
    id: "2026-07-18-d",
    date: "July 18, 2026",
    title: "Your settings are now yours alone on shared computers",
    tag: "improvement",
    summary:
      "Appearance settings — color palette, font, text size, reduce motion — and your AI model choice now belong to your account instead of the browser. Two people sharing one computer each keep their own look, and signing back in restores yours instantly.",
    items: [
      "Each account gets its own palette, font, text size, motion, and model preferences.",
      "Existing settings carry over automatically to the first account that signs in.",
      "Signing out keeps your preferences safe for the next time you sign in.",
    ],
  },
  {
    id: "2026-07-18-c",
    date: "July 18, 2026",
    title: "Clear loading feedback everywhere + smoother mobile navigation",
    tag: "improvement",
    summary:
      "Every create and generate action now shows a spinner while it works, so you always know something is happening. On the phone, switching between the bottom tabs slides in the direction you're heading, and a slim progress bar appears at the top whenever a page takes a moment to load.",
    items: [
      "Saving a capture, adding a feed, saving a page, uploading files, and AI generation all show consistent progress indicators.",
      "Longer AI jobs (like building a curriculum) show a clear overlay with what's happening.",
      "Mobile bottom-tab switches now slide left or right to match where you're going; other page changes keep the gentle fade.",
      "A loading bar at the top of the screen and a spinning tab icon show when a page is still on its way.",
      "All of it respects your reduce-motion preference.",
    ],
  },
  {
    id: "2026-07-18-b",
    date: "July 18, 2026",
    title: "A new front page + black-and-white default theme",
    tag: "feature",
    summary:
      "The landing page is now a full editorial front page — masthead, staggered hero headline, four pillars that invert on hover, product mockups, a comparison table, and a big closing call to action, all with scroll-triggered animations. The default theme is now pure black and white.",
    items: [
      "New landing page with a newspaper-style masthead, animated hero, and product screenshots of every part of the app.",
      "Default color theme is now black and white; the warm brass accent is gone.",
      "Hover any pillar to invert it, watch section rules grow in as you scroll, and the hero words rise in sequence.",
      "The whole page reflows cleanly on a phone — no horizontal scroll, grids stack, the comparison table scrolls.",
    ],
  },
  {
    id: "2026-07-18-a",
    date: "July 18, 2026",
    title: "Reading text finally fits the phone screen + smoother page changes",
    tag: "fix",
    summary:
      "The last piece of the mobile text-overflow puzzle: the scroll container under every reader could still grow wider than the phone, so articles, documents, notes, and rabbithole text kept spilling off the right edge. That container is now hard-capped to the screen width. Mobile page transitions also get a small fade/rise so drilling into a folder, article, or hole feels like a deliberate move instead of an abrupt swap.",
    items: [
      "Articles, documents, notes, and rabbithole text now stay fully within the phone screen — no more horizontal clipping.",
      "Opening an item on mobile plays a short fade-in so the transition feels intentional.",
      "Respects the system reduce-motion setting — the animation is skipped for users who prefer it off.",
    ],
  },
  {
    id: "2026-07-18",
    date: "July 18, 2026",
    title: "Consistent mobile layout on any screen size",
    tag: "fix",
    summary:
      "Narrowing your desktop browser now shows the exact same mobile layout as your phone. The shell, side-by-side readers, and loading screens all switch to mobile at a single width, so there's no more in-between view that matched neither.",
  },
  {
    id: "2026-07-13",
    date: "July 13, 2026",
    title: "A proper welcome — guide, landing page & What's New",
    tag: "feature",
    summary:
      "New here? There's now a full guide covering every feature, an animated welcome page, and this very panel so you always see what's changed since your last visit.",
    items: [
      "A complete, plain-English guide to every part of the app — open it anytime from the command palette or Settings.",
      "This “What's New” panel appears when there are updates you haven't seen yet.",
    ],
  },
  {
    id: "2026-07-12b",
    date: "July 12, 2026",
    title: "Pure-black dark theme",
    tag: "improvement",
    summary:
      "Dark mode is now true black instead of dark grey across every colour theme — easier on the eyes and on OLED screens. Cards and menus still stand out cleanly.",
  },
  {
    id: "2026-07-12a",
    date: "July 12, 2026",
    title: "Rabbithole now works on phones",
    tag: "fix",
    summary:
      "You can now highlight text and dig into it on a touchscreen — the “dig” prompt appears on tap-select, and a Holes button lets you jump back out on mobile.",
  },
  {
    id: "2026-07-11b",
    date: "July 11, 2026",
    title: "A smoother mobile experience",
    tag: "improvement",
    summary:
      "Tapping a text box no longer zooms the page on iPhone, dialogs fit and scroll on small screens, and the Tags table is readable on mobile.",
  },
  {
    id: "2026-07-11a",
    date: "July 11, 2026",
    title: "Faster Feeds & Directory",
    tag: "improvement",
    summary:
      "Opening Feeds and the Directory is noticeably quicker — pages load with fewer round-trips, and switching articles feels instant.",
  },
];

/** The newest entry's id — the watermark a user acknowledges by dismissing What's New. */
export const LATEST_CHANGELOG_ID: string | null = CHANGELOG[0]?.id ?? null;

/** Entries the user hasn't acknowledged yet (newer than their saved watermark). */
export function unseenChangelog(lastSeenId: string | null | undefined): ChangelogEntry[] {
  if (!lastSeenId) return CHANGELOG;
  return CHANGELOG.filter((e) => e.id > lastSeenId);
}
