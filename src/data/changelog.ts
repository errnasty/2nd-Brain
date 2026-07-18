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
    id: "2026-07-18-a",
    date: "July 18, 2026",
    title: "Article text stays in view; reader toolbar folds into a menu on phones",
    tag: "fix",
    summary:
      "On narrow phones, article and document text no longer ran off the right edge — the reading column now fits the screen. The article reader's crowded icon row also collapses the star, bookmark, and ask buttons into the ⋯ menu on small screens, so everything fits without squishing.",
    items: [
      "Reading text (articles, documents, rabbithole) no longer gets cut off on the right of a phone screen.",
      "On phones, the article reader's extra actions (star, read-later, ask) are tucked inside the ⋯ menu instead of crowding the top bar.",
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
