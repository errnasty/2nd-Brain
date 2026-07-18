# Spec: Loading feedback, ThinkTank, personalized onboarding, multi-user support

**Date:** July 18, 2026
**Status:** Implemented (July 18, 2026) — all four features shipped on this branch; see `src/data/changelog.ts` entries `2026-07-18-c` through `2026-07-18-f`
**Scope:** Four features, in recommended build order:

1. [Loading animations for creation flows + mobile page transitions](#1-loading-animations--mobile-page-transitions)
2. [Multi-user hygiene (per-user client preferences)](#2-multi-user-hygiene)
3. [Personalized onboarding for new users](#3-personalized-onboarding)
4. [ThinkTank — a topic-learning tab](#4-thinktank--topic-learning-tab)

> Build order rationale: 1 creates the loading primitives everything else uses; 2 makes client prefs per-user before onboarding starts writing them; 3 collects the name/interests that 4 uses for topic suggestions.

## Executive summary (plain language)

- **Loading animations:** every "create" action (notes, feeds, uploads, AI generations) gets a consistent spinner/progress treatment, and moving between tabs on mobile gets a directional slide animation plus a top progress bar when a page is slow to load.
- **ThinkTank:** a new tab where you type any topic (or tap a suggestion) and the AI builds a swipeable deck of 9–12 bite-sized idea cards — like Deepstash/Imprint, but generated on demand and connected to your own notes. Cards can be saved to your library, turned into flashcards, or explored deeper in Rabbithole. V1 is read-at-your-own-pace; the data model is designed so a daily-drip course mode can be added in v2.
- **Personalized onboarding:** the intro tour for new users starts by asking your name, what you want to learn, and your preferred look (palette/theme). The app then greets you by name and seeds ThinkTank with your interests.
- **Multi-user:** appearance settings, the onboarding-seen flag, and model choices are currently shared by everyone using the same browser. They become scoped per account, so two people sharing a computer each get their own experience.

---

## 1. Loading animations + mobile page transitions

### Problem

- Creation flows all go through async Server Actions, but loading feedback is ad-hoc across ~44 files: some buttons swap text ("Saving…"), some show a `Loader2` spinner, some show nothing. `quick-capture.tsx` — the most-used creation surface — has no spinner at all.
- Page-to-page navigation on mobile has zero feedback: no transition animation between bottom tabs and no pending indicator when a route is slow (the desktop sidebar's `NavHint` already shows a spinner via `useLinkStatus().pending`; mobile has nothing).

### 1a. Shared loading primitives (new files)

| File | Export | Behavior |
|---|---|---|
| `src/components/ui/spinner.tsx` | `Spinner({ className })` | Thin wrapper around lucide `Loader2` + `animate-spin`. Single import point. |
| `src/components/ui/loading-button.tsx` | `LoadingButton({ loading, loadingText, ...buttonProps })` | Extends the existing shadcn `Button` (keeps `variant`/`size`). When `loading`: `disabled`, `aria-busy`, leading `<Spinner className="h-4 w-4" />`, label = `loadingText ?? children`. Keep width stable (spinner replaces any leading icon slot) to avoid layout jump. |
| `src/lib/use-async-action.ts` | `useAsyncAction(fn)` → `{ run, pending }` | Wraps a server-action call in `useTransition`, catches unexpected rejections into `toast.error`, guards double-submit. Replaces the ad-hoc `const [saving, setSaving] = useState(false)` pattern. Actions returning `{ ok, error }` keep their own success handling. |
| `src/components/ui/busy-overlay.tsx` | `BusyOverlay({ show, label })` | Translucent card overlay with `Spinner` + label ("Distilling…", "Building your deck…"). Entrance via `motion-safe:animate-in fade-in-0` (tailwindcss-animate). For multi-second AI calls where a button spinner under-communicates. |

### 1b. Retrofit (representative set — same mechanical swap applies to the rest of the ~44 sites over time)

- `src/components/shell/quick-capture.tsx` — footer button → `LoadingButton loading={saving}` (currently text-only).
- `src/components/feeds/add-feed-dialog.tsx` — `useTransition` + "Adding…" → `LoadingButton`.
- `src/components/directory/curriculum-dialog.tsx`, `gaps-dialog.tsx` — `LoadingButton` + `BusyOverlay` during AI generation.
- `src/components/directory/item-viewer.tsx` — Distill / Generate-flashcards buttons.
- `src/components/directory/bulk-action-bar.tsx` — bulk move/tag/distill.
- `src/components/documents/upload-zone.tsx` — per-file `Spinner` rows while `uploadToDirectoryAction` runs.
- `src/components/directory/save-url-dialog.tsx` — already the good example (`Loader2`); migrate to `LoadingButton` so there is exactly one pattern.

### 1c. Mobile page transitions

**Directional slide between bottom tabs.**

- `tailwind.config.ts` — add keyframes next to the existing `page-in` (~L76-85):
  - `page-in-left`: `from { opacity: 0; transform: translateX(24px) }` (moving to a tab further right)
  - `page-in-right`: `from { opacity: 0; transform: translateX(-24px) }` (moving left)
  - ~0.18s ease-out.
- `src/components/shell/page-transition.tsx` — keep keying the wrapper on `pathname` (preserves the invariant that search-param navigations don't remount). Add a `usePrevious(pathname)` ref and a tab-order map matching `TABS` in `mobile-nav.tsx` (`/today` → 0, `/feeds` → 1, `/directory` → 2, `/ask` → 3). When both previous and current pathname resolve to tab indices, pick `max-lg:motion-safe:animate-page-in-left|right` by index delta; desktop (`lg:`) and all non-tab navigations keep the existing fade/rise.
- Reduce-motion needs **no new code**: `motion-safe:` covers OS-level `prefers-reduced-motion`, and the in-app toggle is enforced globally by `html[data-reduce-motion="true"] *` in `globals.css` (~L234-237).

**Perceived-latency gap (cold navigations / slow RSC).**

- New `src/components/shell/route-progress.tsx` — a fixed indeterminate 2px top bar (brand color, CSS keyframe slide). Mechanism: a tiny `<PendingReporter />` rendered *inside* each nav `<Link>` (mobile tabs, sidebar, More sheet) calls `useLinkStatus()` and dispatches `route-pending` / `route-settled` window events — the same pattern `NavHint` in `sidebar.tsx` (~L177-185) already proves. `RouteProgress` (mounted once in `(app)/layout.tsx`) listens, shows the bar, and force-hides on `usePathname()` change as a safety net.
- `src/components/shell/mobile-nav.tsx` — inside each bottom-tab `Link`, swap the tab icon for a `Spinner` while `useLinkStatus().pending`.
- Known v1 gap: programmatic `router.push` (e.g. folder drawer) won't drive the bar — acceptable; document inline.

### Verification

- `npm run lint && npm run build`.
- DevTools mobile viewport: Today↔Feeds↔Directory↔Ask slide in the correct directions; drilling into a directory item keeps the fade; Settings reduce-motion collapses all animation; OS `prefers-reduced-motion` emulation does the same.
- Slow 3G throttling with router cache disabled: top progress bar + tab spinner appear during navigation.
- Create a note via quick capture, add a feed, upload a doc, run Distill — every path shows a spinner.

---

## 2. Multi-user hygiene

### Problem

All real content is already isolated per account (`userId` on every table; `clearOfflineMirror()` wipes the Dexie sidebar cache on login/signup). But **client-side prefs are browser-global localStorage**, shared by every account on one machine:

`app.palette.v1`, `app.fontFamily.v1`, `app.fontScale.v1`, `app.reduceMotion.v1`, `onboarding.v1.done`, `ask.model.v1` (4 call sites: ask-shell, settings-form, reader/rabbithole, doc-query-panel), `sidebar.volumeNumber.v1`.

Consequences today: the second person on a shared computer inherits the first person's palette/fonts, never sees the onboarding tour, and shares the Ask model choice.

### Design: scoped localStorage keys

In `src/lib/settings.ts`:

- `ACTIVE_USER_KEY = "app.activeUser.v1"` stores a short stable hash (8 chars) of the Supabase user id — avoids a raw uuid in a shared-browser key.
- `setActiveUser(userId)`, `getActiveUserHash()`, and `scopedKey(base)` → `` `${base}.u_${hash}` `` (falls back to `base` when no user is set, so login/signup pages keep working).
- Rewrite the existing get/set pairs (palette, font family, font scale, reduce motion) to use `scopedKey(...)` with **legacy fallback + lazy migration**: if the scoped key is empty but the legacy key exists, return the legacy value and copy it into the scoped key. First account to log in inherits the old prefs; later accounts get defaults.
- Export `getScopedItem` / `setScopedItem` helpers; replace the four `ask.model.v1` call sites' local reads with them.

Wiring:

- `settings-effects.tsx` gains a `userId` prop and calls `setActiveUser(userId)` **before** `applyStoredSettings()`; mount from `(app)/layout.tsx` where the user id is available.
- The root layout's pre-paint inline palette script is updated to read `app.activeUser.v1` first, then try `app.palette.v1.u_<hash>`, then legacy — a few lines of vanilla JS (regression risk: verify no palette flash on hard reload in both themes).
- Login (`src/app/login/page.tsx`) and signup (`src/app/signup/signup-form.tsx`) — both already call `clearOfflineMirror()` — additionally call `setActiveUser(newUserId)`. Sign-out (`src/components/settings/sign-out.tsx`, `danger-zone.tsx`) removes only the `ACTIVE_USER_KEY` marker; scoped prefs stay in place so a returning user gets their appearance back instantly.

### What lives where

| Preference | Storage | Why |
|---|---|---|
| `onboardingDone`, `interests` | server, `user_settings` JSONB | must be cross-device (see §3) |
| palette, fonts, font scale, reduce motion, ask model, sidebar volume | localStorage, scoped per user | device/display prefs, applied pre-paint; server round-trip would block first paint |
| `onboarding.v1.done` (localStorage) | becomes a scoped fast-path cache only | server flag is authoritative |

Optional v2 (documented, not built): background-mirror appearance prefs into `user_settings` for cross-device sync.

### Verification

- Two accounts, one browser: A sets Ocean palette + custom font + name → sign out → B signs up → gets defaults + onboarding → sign out → A signs in → Ocean + font restored pre-paint (no flash), no onboarding replay.
- Seed legacy un-scoped keys, log in → values inherited and copied to scoped keys.
- Ask model choice no longer leaks between accounts (ask-shell, doc-query-panel, rabbithole).

---

## 3. Personalized onboarding

### Problem

Current onboarding (`src/components/shell/onboarding.tsx`) is a 9-step purely informational tour gated by browser-global `localStorage["onboarding.v1.done"]`. It collects nothing, so the app can't greet the user or tailor anything. Meanwhile `profiles.displayName` exists in the schema (`src/lib/db/schema.ts` ~L38-54) but no UI writes or reads it.

### Persistence plumbing (do first)

- Extend `UserSettingsData` (JSONB in `user_settings`, additive — **no migration**, same precedent as `lastSeenChangelog`):

  ```ts
  onboardingDone?: boolean;   // replaces localStorage as source of truth
  interests?: string[];       // topics picked at onboarding; seeds ThinkTank
  ```

- New `src/lib/profile/actions.ts` (`"use server"`):
  - `updateDisplayNameAction(displayName)` — trim/validate (≤60 chars), update `profiles.displayName`, `revalidatePath("/today")`.
  - `interests` / `onboardingDone` go through the existing `updateUserSettingsAction` (`src/lib/settings/actions.ts`). Caveat: it shallow-merges, so always send the whole `interests` array.

### Onboarding flow rework (`src/components/shell/onboarding.tsx`)

- **Server-driven gating:** `Onboarding({ initialDone, initialName })` props from `(app)/layout.tsx`, which already calls `getUserSettings(user.id)` for the changelog watermark — piggyback `onboardingDone` on that read; fetch `profiles.displayName` alongside (one cheap query) and pass to Onboarding + Sidebar + Today.
- **Legacy backfill:** on mount, if `initialDone` is false but legacy `localStorage["onboarding.v1.done"] === "1"`, silently call `updateUserSettingsAction({ onboardingDone: true })` and don't show — existing users are never re-nagged.
- **New step sequence** (interactive steps first; total ≤ ~8 by condensing the current tour):
  1. Welcome (existing).
  2. **"What should we call you?"** — text input prefilled from `initialName`; Next → `updateDisplayNameAction` via `LoadingButton`. Skippable.
  3. **"What do you want to learn?"** — chip picker: ~12 starter suggestions + free-text add; Next → `updateUserSettingsAction({ interests })`. Copy notes these seed ThinkTank. Skippable.
  4. **"Make it yours"** — palette radio (`PALETTE_OPTIONS`) + light/dark toggle (next-themes); applies live via the now-scoped `setPalette` (§2).
  5–8. Condensed tour: Capture, Today/Feeds, Directory/Study, Ask/Shortcuts.
- `finish()` → `updateUserSettingsAction({ onboardingDone: true })` + scoped-localStorage fast flag. Replay via the existing `open-onboarding` event, running in "edit" mode with fields prefilled.

### Surfacing the personalization

- `src/app/(app)/today/page.tsx` — make `profiles.displayName` the first-priority source in `firstNameOf` (fail-soft), pass into the `DailyBrief` greeting.
- `src/components/shell/sidebar.tsx` — displayName above the email line in the masthead.
- `src/components/settings/settings-form.tsx` + `settings/page.tsx` — new "Profile" section: displayName input (LoadingButton save) + editable interests chip list, so onboarding choices are revisitable.

### Verification

- Fresh signup → tour auto-opens; enter name + 3 interests + Ocean → Today greets by name, ThinkTank suggests those interests, palette survives reload.
- Existing user with legacy flag: no re-show; server flag backfilled.
- Same account, second browser: onboarding does **not** re-show (server flag) — the cross-device win.
- Skip everything: defaults hold; closing still counts as seen (existing behavior).

---

## 4. ThinkTank — topic-learning tab

### Concept

An Imprint/Deepstash-style learning experience. Those apps rely on editorial content teams; this app has none — but it has strong AI machinery (curriculum builder, flashcards, RAG, Rabbithole). So ThinkTank **generates** the content:

1. **Pick a topic** — free-text input, or tap a suggestion (from onboarding `interests` + the user's top library tags).
2. **AI builds a deck** — 9–12 bite-sized "idea cards" (one big idea, ≤~80 words each), ordered *prerequisites → core → advanced*, grounded in and citing the user's own related notes/articles where they exist.
3. **Swipe through** — full-screen card reader; progress dots; resume position saved.
4. **Each card:** *Save to library* (Directory note), *Make flashcards* (Study/FSRS queue), *Go deeper* (Rabbithole).
5. **Deck finish:** offer "Build full curriculum note" (`/api/curriculum`) and "Find my knowledge gaps" (`/api/gaps`).

**Confirmed product decisions:**
- **Pacing — "deck now, drip later":** v1 is read-anytime; the schema carries a `pacing` column so a v2 daily-drip mode (daily unlock, Today-page "today's lesson", streaks via existing gamify) can be layered on without schema rework.
- **Topics — any topic + smart suggestions** (not a curated catalog, not library-only).
- **Integration — deep:** cards flow into Directory, Study, and Rabbithole.

### Data model (`src/lib/db/schema.ts`)

```
thinktank_deck_status enum: "generating" | "ready" | "error"
thinktank_deck_pacing enum: "free" | "daily"        -- v1 always "free"

thinktank_decks
  id            uuid pk defaultRandom
  user_id       uuid → profiles.id on delete cascade
  topic         text not null
  title         text not null          -- AI-polished display title
  description   text
  status        thinktank_deck_status default 'ready'
  pacing        thinktank_deck_pacing default 'free'   -- v2 drip switch
  last_position integer default 0      -- reader resume point
  created_at / updated_at timestamps
  index (user_id, created_at desc)

thinktank_cards
  id            uuid pk defaultRandom
  user_id       uuid → profiles.id cascade
  deck_id       uuid → thinktank_decks.id cascade
  position      integer not null       -- doubles as day-index for v2 drip
  section       text not null          -- "prerequisites" | "core" | "advanced"
  title         text not null          -- the big-idea headline
  body          text not null          -- ≤ ~80 words markdown
  source_refs   jsonb                  -- [{ itemId?, title, url? }]
  saved_item_id uuid                   -- set when saved to Directory (idempotency)
  created_at    timestamp
  index (deck_id, position)
```

Migrations:
1. `npx drizzle-kit generate` → hand-author `supabase/migrations/0021_thinktank.sql` (next after `0020_quiz.sql`, matching existing style).
2. **Desktop parity:** matching `create table if not exists` blocks in `src/lib/db/local-bootstrap.ts` **and** both table names added to the sync/tombstone table lists (~L80/L85 pattern). Open question: include in desktop sync in v1, or ship cloud-only (hide the tab on desktop offline) — decide during implementation after testing against the sync engine.

### Routes & server actions

- `src/app/(app)/thinktank/page.tsx` (server) — hub: topic input, suggested-topic chips, grid of decks with progress (`lastPosition / cardCount`).
- `src/app/(app)/thinktank/[deckId]/page.tsx` — the card reader.
- `src/app/(app)/thinktank/loading.tsx` — skeleton matching sibling sections.
- `src/app/(app)/thinktank/actions.ts`:
  - `createThinkTankDeckAction(topic)`:
    1. `requireUser()`; `checkRateLimit(user.id, "analyze", 20, 60)` (same budget as `/api/curriculum`).
    2. `retrieveFromDirectory(user.id, topic, 15)` (`src/lib/ai/rag.ts`) for grounding.
    3. One AI call via `webAnswerOnce` → fallback `plainAnswerOnce` (`src/lib/ai/web-answer.ts`, `DEFAULT_CHAT_MODEL`), system prompt requesting **strict JSON** `{ title, description, cards: [{ section, title, body, refs }] }`; reuse the JSON-parse/repair conventions from `src/lib/ai/flashcards.ts` / `quiz.ts`. On unrecoverable parse failure: `status='error'` + retry button, never a broken deck.
    4. Insert deck + cards in one transaction; `awardXp(user.id, { source: "curriculum", ... })` (reuse existing source, no gamify schema churn).
    5. Return `{ ok, deckId }`; client redirects. V1 awaits inline behind `LoadingButton` + `BusyOverlay` ("Building your deck… ~20s"); the `status` column enables an async upgrade later without schema change.
  - `saveCardToLibraryAction(cardId)` — wraps existing `createNoteAction` (directory/actions.ts ~L346) with card title/body + "From ThinkTank: {topic}" footer; stamps `saved_item_id`.
  - `makeFlashcardsFromCardAction(cardId)` — wraps existing `createCardsFromTextAction` (review/actions.ts ~L265).
  - `setDeckPositionAction(deckId, position)` — fire-and-forget resume point.
  - `deleteDeckAction(deckId)`.

### Reader UX (`src/components/thinktank/`)

- `card-reader.tsx` (client) — horizontal swipeable deck via CSS `scroll-snap-type: x mandatory` with full-width snap children (native swipe on mobile, **no framer-motion** — repo convention is pure CSS). Arrow keys + prev/next buttons on desktop; progress dots (reuse onboarding dots pattern); section eyebrow ("§ Prerequisites"). IntersectionObserver on snap children → debounced `setDeckPositionAction`.
- Per-card action row: **Save to library**, **Make flashcards** (both `LoadingButton`), **Go deeper →** (Rabbithole seeded with the card title).
- Deck-finish footer: "Full curriculum note" (`/api/curriculum`) and "Find my gaps" (`/api/gaps`).
- `new-deck-form.tsx`, `deck-list.tsx` for the hub.

### Navigation

- `src/components/shell/sidebar.tsx` — add to `nav` (~L23-32): `{ href: "/thinktank", label: "ThinkTank", icon: Lightbulb, chord: "K" }` (T/A/F/D/S/R/M/G taken).
- `src/components/shell/keyboard-shortcuts.tsx` — add the `g k` jump entry (chords derive from this list).
- `src/components/shell/mobile-nav.tsx` — bottom bar is full (4 tabs + More), so add to `MORE_LINKS` (~L40-47) and `TITLES` (~L49-59).
- Optional: command-palette entry.

### v2 drip mode (designed for, not built)

- Flip a deck to `pacing='daily'`: cards unlock one per day by `position` (computed from `created_at` + day index — no unlock job needed for v1 of drip).
- Today page gets a "Today's lesson" card linking to the next unlocked card.
- Streaks reuse the existing gamify streak machinery.

### Verification

- Apply migration to a dev DB; confirm desktop PGlite boots (`local-bootstrap.ts`).
- Generate decks for a topic with and without related library items → grounded refs vs pure-web cards; unset `ANTHROPIC_API_KEY` → friendly fail-soft error.
- Mobile viewport: swipe through; save a card (appears in Directory Unsorted); make flashcards (appear in Study due counts); leave and return → resume position.
- 21st generation within an hour → rate-limit message.

---

## Risks & open questions

1. **PageTransition direction state** — previous-pathname tracking must not break the "search-param navigations don't remount" invariant (key stays pathname-only).
2. **Progress bar coverage** — `useLinkStatus` only works inside `<Link>`; programmatic `router.push` won't drive the bar. Accepted v1 gap.
3. **ThinkTank desktop sync** — new tables in the PGlite sync/tombstone lists need testing against the sync engine; fallback is cloud-only in v1.
4. **AI strict-JSON reliability** — mitigated by reusing repair parsing + `status='error'` retry path.
5. **Generation latency** — ~10–30s inline behind BusyOverlay; `status` column is the async escape hatch.
6. **`updateUserSettingsAction` shallow merge** — `interests` must be sent whole; two concurrent tabs can clobber. Low stakes.
7. **Onboarding length** — 3 interactive steps + condensed tour must stay ≤ ~8 steps or completion drops; needs copy work.
8. **Pre-paint script edit** — palette-flash regression risk; verify hard reloads in both themes.
9. **`g k` chord** — bare chord is distinct from `⌘K` palette; confirm no conflict in `keyboard-shortcuts.tsx`.

## Changelog note

Each feature, when implemented, prepends its own user-facing `ChangelogEntry` to `src/data/changelog.ts`. This spec itself is docs-only and adds no entry.
