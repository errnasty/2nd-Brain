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
