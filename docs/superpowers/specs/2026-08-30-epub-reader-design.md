# ePub reader — design

Date: 2026-08-30
Status: approved

## Problem

`.epub` upload already works, but only as text: [`extractEpub`](../../../src/lib/documents/parsers/epub.ts)
unzips the book, strips every tag, and stores one flat string in
`documents.full_text`. The original file is discarded. A book is therefore
readable only as an undifferentiated wall of text — no chapters, no formatting,
no images, no place to resume.

## Feasibility

Settled before design:

- **Railway, not Vercel.** A plain Node server with no serverless body cap.
  `serverActions.bodySizeLimit` is already `20mb` and 20MB uploads work today.
- **The spine walk already exists** — container.xml → OPF → manifest → spine,
  via JSZip + fast-xml-parser. The reader needs the same walk keeping HTML
  instead of discarding it.
- **`documents.storage_path` already exists** and nothing writes it.
- **`SUPABASE_SERVICE_ROLE_KEY` is already configured**, so server-side bucket
  writes need no new credentials.
- **`sanitize-html` and `lib/sanitize.ts` already guard article HTML** and are
  reused verbatim for chapter XHTML.
- **CSP needs no change.** Chapters and images are served from `'self'`.
  epub.js was rejected partly for this: it renders into a `blob:` iframe, and
  the CSP has no `frame-src`, so `default-src 'self'` would block it silently.

Size is not an obstacle; it is the argument for slicing chapters server-side.
The client fetches one ~40KB chapter at a time and never holds the book.

## Decisions

| Question | Choice |
| --- | --- |
| Where the bytes live | Supabase Storage, original `.epub` kept |
| Page turn | Paginated columns |
| Features | Core reading + AI on the book |
| Size cap | 50MB, `.epub` only |
| Where it opens | Dedicated full-screen `/read/[id]` |
| AI scope | Whole book by default, per-book spoiler-safe toggle |
| Covers | Extracted and shown |

Explicitly out of scope: highlights and margin notes, find-in-book, bookmarks.

## Data model — migration 0034

```
documents.storage_path            already exists; finally written to
document_chunks.chapter_index     new nullable int, backs the spoiler clamp

book_chapters       (document_id, idx, href, title, char_count, nav_level)
book_reading_state  (user_id, document_id, chapter_idx, char_offset,
                     progress_pct, spoiler_safe, font_scale, theme)
```

`book_reading_state` is one row per reader per book, holding the resume anchor
and the per-book preferences together so the spoiler toggle has somewhere to
live without a settings table.

Storage bucket `books`, private.

## Upload — all the work happens once

The read path must never unzip. Upload unzips exactly once and writes out
everything a reader needs, flat:

```
books/{userId}/{docId}.epub             original, kept
books/{userId}/{docId}/ch/{idx}.html    sanitized chapter, ~20-80KB
books/{userId}/{docId}/assets/…         images and fonts
books/{userId}/{docId}/cover.{ext}
```

Chapter `<img src>` is rewritten at this stage to point at
`/api/book/{id}/asset/…`. Chapter titles come from `nav.xhtml` (EPUB 3) or
`toc.ncx` (EPUB 2), falling back to the first heading in the chapter, then to
"Chapter N". `full_text` and chunking are unchanged except that each chunk now
records its `chapter_index`.

Storage costs roughly 2x the book. On Supabase's 1GB free tier that is about
ten large textbooks, or a hundred novels.

**Memory is the real risk.** JSZip holds the archive in RAM, so the spine must
be walked entry by entry — write each chapter out, drop it, move on. Never
materialise every chapter's HTML at once.

## Serving

- `GET /api/book/[id]/chapter/[idx]` — one sanitized chapter.
- `GET /api/book/[id]/asset/[...path]` — an image or font from the book.

The chapter list and reading state are not an endpoint: `/read/[id]` is a
dynamic server component and reads them straight from the database, which is
also what makes resuming on another device work without any sync.

Each checks ownership, then fetches one small object with the service-role
client. No unzip, no 50MB download, no signed-URL expiry to manage.

## The reader — `/read/[id]`

Deliberately outside the `(app)` route group: full screen, no sidebar, no
bottom tab bar. Middleware still protects it.

CSS multi-column in a fixed-height box, translated on the X axis one page at a
time. Swipe, arrow keys, and a `⟨ 84 / 312 ⟩` footer. Chapter list and settings
live in a slide-over.

**Position is never a page number.** It is `{chapterIdx, charOffset}`. Font
size, rotation and resize all reflow the columns, and the anchor still
resolves: walk the text nodes to the offset, find the column it lands in, jump
there. Progress is `(chars before this chapter + offset) / total chars`,
computed from `book_chapters.char_count`, so it does not depend on layout at
all.

## AI

Ask, Distill, flashcards and Rabbithole already work on `uploaded_document`.
The only new plumbing is the clamp: with `spoiler_safe` on, retrieval filters
`chapter_index <= furthest chapter reached`. Off by default.

## Edge cases

- **DRM cannot be supported.** Detect `META-INF/encryption.xml` and say so
  plainly rather than failing with a parse error.
- **Fixed-layout books** (comics, manga) render badly in columns. Detect
  `rendition:layout=pre-paginated` and fall back to scrolling.
- **Existing uploaded epubs have no bytes.** They keep working as flat text;
  the row offers a re-upload.
- 50MB cap applies to `.epub` only; every other kind stays at 20MB.

## Testing

Vitest on the pure functions — the parsing and maths, not the DOM:

- spine/manifest resolution including relative hrefs and an OPF in a
  subdirectory
- nav.xhtml and toc.ncx title extraction, and the fallbacks
- `progressFor`, and the anchor round trip
- DRM and fixed-layout detection
- asset path rewriting, including `../` escapes that must not leave the book

## Build order

Five independently shippable chunks: migration + bucket → upload pipeline →
chapter API → reader route → AI clamp + covers.
