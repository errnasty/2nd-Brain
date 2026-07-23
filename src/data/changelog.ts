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
    id: "2026-07-23-n",
    date: "July 23, 2026",
    title: "Create folders right where you're browsing",
    tag: "feature",
    summary:
      "You can now add a new subfolder directly from inside the folder you're viewing, or with a quick hover button in the sidebar tree — no need to jump back to the top-level folder list.",
  },
  {
    id: "2026-07-23-m",
    date: "July 23, 2026",
    title: "Breadcrumbs, drag-to-nest, and bulk folder actions",
    tag: "feature",
    summary:
      "The Directory now shows a breadcrumb trail so you always know where you are, and you can drag folder tiles onto each other to nest them. Select multiple folders at once to move or delete them together.",
  },
  {
    id: "2026-07-23-l",
    date: "July 23, 2026",
    title: "Recently viewed, filtering, and saved views in the sidebar",
    tag: "feature",
    summary:
      "The Directory sidebar now keeps a short list of recently opened folders and notes, lets you filter the folder tree by typing, and lets you save a combination of tags as a named view you can jump back to.",
  },
  {
    id: "2026-07-23-i",
    date: "July 23, 2026",
    title: "Browse folders like a file tree",
    tag: "feature",
    summary:
      "The Directory sidebar now expands folders to show their subfolders and files right in the tree, like a code editor. Opening a folder that only contains subfolders now shows those subfolders as clickable tiles instead of a confusing empty screen.",
  },
  {
    id: "2026-07-23-j",
    date: "July 23, 2026",
    title: "A cleaner Directory toolbar",
    tag: "improvement",
    summary:
      "Less-used actions (curriculum, knowledge gaps, save from URL, study folder) are now tucked into a single \"More\" menu, and folder labels are simpler — so the toolbar and headings stay tidy on both desktop and mobile.",
  },
  {
    id: "2026-07-23-k",
    date: "July 23, 2026",
    title: "Review auto-organize suggestions before they apply",
    tag: "improvement",
    summary:
      "Auto-organize now shows exactly what it wants to do — including any new folders it wants to create — as a checklist you approve before anything moves, instead of silently reorganizing your library.",
  },
  {
    id: "2026-07-23-f",
    date: "July 23, 2026",
    title: "Ask no longer shows a scary error on long answers",
    tag: "fix",
    summary:
      "Long answers used to sometimes fail with a generic \"network error\" that threw away everything already written. Ask now starts streaming right away, and if the connection ever does drop mid-answer, whatever was written stays on screen with a Retry option instead of vanishing.",
  },
  {
    id: "2026-07-23-g",
    date: "July 23, 2026",
    title: "See what the model is thinking",
    tag: "feature",
    summary:
      "A new \"Show thinking\" option in the Tools menu streams the model's reasoning in a collapsible panel above the answer, for Claude models and several reasoning-capable OpenRouter models.",
  },
  {
    id: "2026-07-23-h",
    date: "July 23, 2026",
    title: "Agent mode can now propose changes to your library",
    tag: "feature",
    summary:
      "In Agent mode, the assistant can propose creating or editing notes, adding tasks, tagging, moving items, or deleting something — each shown as an Approve/Discard card so nothing changes in your Directory until you say yes. Deletions always require your explicit approval.",
  },
  {
    id: "2026-07-23-e",
    date: "July 23, 2026",
    title: "Ask is faster and more reliable",
    tag: "fix",
    summary:
      "A round of Ask fixes: asking a question right after creating a study plan no longer errors, the assistant now remembers facts in normal chats (not just Agent mode), Agent mode works whichever provider you use, and answers stream more smoothly.",
    items: [
      "Fixed an error that could occur on your next question after a study plan was created.",
      "Suggestions and follow-up chips now respect the mode you're in (Agent / Study plan).",
      "Remembered facts are used in ordinary Ask chats too, not only Agent mode.",
      "Faster: skips unnecessary work on self-contained questions and overlaps setup steps.",
    ],
  },
  {
    id: "2026-07-23-d",
    date: "July 23, 2026",
    title: "Ask can now work in multiple steps",
    tag: "feature",
    summary:
      "A new Agent mode lets Ask take several steps to answer harder questions — searching your library, opening specific items, and checking the web as needed — and it can remember lasting facts about you across conversations.",
    items: [
      "Turn on “Agent (multi-step)” in the Tools menu for questions that need digging — comparing across documents, following a trail, or blending your notes with fresh web facts. You'll see each step as it works.",
      "The agent can remember durable facts you tell it (like what you're studying) and use them in future chats.",
      "If your selected model can't run tools, the agent automatically uses a capable one for that answer.",
    ],
  },
  {
    id: "2026-07-23-c",
    date: "July 23, 2026",
    title: "Ask answers you can trust",
    tag: "improvement",
    summary:
      "The [1], [2] references in an Ask answer are now tappable and jump straight to the note or article they came from. And a new “Verify answers” option double-checks the answer against your sources and flags anything they don't actually support.",
    items: [
      "Tap any citation in an answer to open the exact source it's drawn from.",
      "Turn on “Verify answers” (in the Tools menu) to get a badge on each answer — verified, partly supported, or unsupported — with the specific claims your sources don't back.",
    ],
  },
  {
    id: "2026-07-23-b",
    date: "July 23, 2026",
    title: "Ask gives sharper, more honest answers",
    tag: "improvement",
    summary:
      "Ask now understands follow-up questions in context and digs up better sources — and when something genuinely isn't in your library, it says so instead of bluffing.",
    items: [
      "Follow-ups like “what about the second one?” now search correctly by resolving what you meant from the conversation.",
      "Retrieved sources are re-ranked by how well they actually answer your question, so the strongest evidence leads.",
      "When your library doesn't cover a question, Ask tells you plainly and suggests turning on web search — rather than answering as if it came from your notes.",
    ],
  },
  {
    id: "2026-07-23",
    date: "July 23, 2026",
    title: "Ask now remembers your conversations",
    tag: "feature",
    summary:
      "Ask has been rebuilt into a proper assistant: your conversations are saved, so you can leave and come back to them, and they follow you across your devices. It's the first step of a bigger Ask overhaul.",
    items: [
      "A conversation sidebar (and a slide-in drawer on mobile) with all your past chats — rename, delete, and jump back into any of them.",
      "“New chat” starts a fresh thread; refreshing the page no longer loses your conversation.",
      "A cleaner, roomier chat layout on both desktop and phone, with the extra tools (web search, study plan, voice, attach) tucked into one tidy menu so the composer stays uncluttered.",
    ],
  },
  {
    id: "2026-07-22",
    date: "July 22, 2026",
    title: "A new logo",
    tag: "improvement",
    summary:
      "Second Brain has a new mark — a small neural network standing for knowledge as a connected web. You'll see it in the sidebar, on the sign-in screen, and as the app icon and browser tab favicon.",
  },
  {
    id: "2026-07-21-b",
    date: "July 21, 2026",
    title: "A smarter, faster Today page",
    tag: "feature",
    summary:
      "Your daily brief now generates once and loads instantly on every device, and the Today page opens with an at-a-glance strip of everything due — reviews, new deck cards, tasks, and your streak.",
    items: [
      "Your brief is saved to your account, so opening Today on another device loads it instantly instead of regenerating (and burning tokens) again.",
      "A new day auto-refreshes the brief in the background — yesterday's stays on screen until the fresh one is ready.",
      "The [1], [2] references in the brief are now tappable and jump straight to that article.",
      "One tidy “at a glance” row replaces the stacked banners — due cards, unlocked deck cards, tasks due today, and your streak, in one place. In the evening it switches to a wind-down view that leads with your reviews.",
      "Briefs are leaner to generate, cutting their token cost roughly in half with no change to what you read.",
    ],
  },
  {
    id: "2026-07-21",
    date: "July 21, 2026",
    title: "Today page fits your phone",
    tag: "fix",
    summary:
      "The Regenerate button no longer runs off the edge of the screen on phones, the review reminder is tighter, and the greeting now matches the actual time of day instead of staying stuck on last night's.",
  },
  {
    id: "2026-07-20-d",
    date: "July 20, 2026",
    title: "Housekeeping AI now runs on free models",
    tag: "improvement",
    summary:
      "Auto-tagging, folder routing, auto-organize, and skill classification now run on free OpenRouter models (with automatic fallback to your regular model if they're busy) — the high-volume background chores stop costing you tokens.",
  },
  {
    id: "2026-07-20-c",
    date: "July 20, 2026",
    title: "Your model choice now applies everywhere",
    tag: "improvement",
    summary:
      "The model you pick in Settings (including “Auto — best value”) now drives every AI feature in the app — ThinkTank decks, quizzes, flashcards, summaries, tagging, and study plans — not just the Ask tab. Works with Claude direct, OpenRouter, and OpenAI models, and syncs across your devices.",
  },
  {
    id: "2026-07-20-b",
    date: "July 20, 2026",
    title: "Deck building works reliably at every depth",
    tag: "fix",
    summary:
      "Standard and Deep decks were running out of room mid-write and failing with “couldn't build a deck”. Decks now get a writing budget sized to their depth, a deck that comes back slightly short or long is kept instead of rejected, and when a build does fail the app tells you the actual reason.",
  },
  {
    id: "2026-07-20",
    date: "July 20, 2026",
    title: "ThinkTank and Rabbithole work properly on your phone",
    tag: "fix",
    summary:
      "Two big mobile fixes: decks can no longer get stuck on “Building…” forever, and selecting text in a rabbithole on your phone now brings up the dig tools.",
    items: [
      "A deck build that silently dies now shows as “Stalled” with a one-tap retry — and opening the deck restarts it automatically. Builds also get twice as long to finish before timing out.",
      "On phones, selecting text in a rabbithole now opens a bottom bar with the Explain / ELI5 / Example / Go Deeper lenses — adjusting the selection with the drag handles works too.",
      "Topic suggestions are now a tidy row of six instead of a wall of chips.",
    ],
  },
  {
    id: "2026-07-19-c",
    date: "July 19, 2026",
    title: "Snappier everywhere",
    tag: "improvement",
    summary:
      "The app ships less code up front and shows instant feedback while screens load. The Study hub in particular opens noticeably faster, and opening a deck, the rabbithole, search, settings, or the map now paints immediately instead of pausing on a blank screen.",
  },
  {
    id: "2026-07-19-b",
    date: "July 19, 2026",
    title: "ThinkTank levels up: daily decks, quizzes, and more",
    tag: "feature",
    summary:
      "ThinkTank decks can now drip out a few cards a day so a topic becomes a habit instead of a one-sitting read — and finishing a deck opens a whole toolkit for locking the ideas in.",
    items: [
      "New “Daily” pace when building a deck: 5 fresh cards unlock each day, and your Today page nudges you when they're ready.",
      "Finish a deck and you can quiz yourself on it, turn the whole deck into flashcards in one tap, or rebuild the topic at full depth — plus you now earn XP for finishing.",
      "“Go deeper” on a card now drops you straight into a rabbithole on that idea (saving the card for you along the way).",
      "On your phone, tap the left or right edge of a card to flip between cards.",
      "The deck list now updates itself while a deck is building, shows each deck's depth, and failed decks can be retried right from the list.",
      "Topic suggestions now include things you've just read in Feeds.",
    ],
  },
  {
    id: "2026-07-19",
    date: "July 19, 2026",
    title: "Feeds and Directory are much faster with big libraries",
    tag: "improvement",
    summary:
      "The two heaviest screens got dedicated database tuning. Opening Feeds views (All, Hot, Starred) and Directory lists (default, a folder, Unsorted) now uses purpose-built indexes instead of scanning your whole collection — the bigger your library, the bigger the speedup.",
    items: [
      "Every Feeds view and Directory list now reads straight from an index built for it.",
      "Desktop gets the same tuning automatically on next launch.",
      "Also speeds up desktop-cloud sync for directory items.",
    ],
  },
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
