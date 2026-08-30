import sanitizeHtml from "sanitize-html";
import { isExternalHref, resolveHref, splitFragment } from "./paths";

/**
 * Turn one chapter's XHTML into something safe to render, with every reference
 * pointing back at us.
 *
 * A book is untrusted input in exactly the way an RSS body is — `lib/sanitize`
 * exists for that — but a chapter needs three things an article does not:
 *
 *   • `id` survives, because a book links to its own footnotes.
 *   • `<img src>` is rewritten from a zip-relative path to an API URL, since
 *     the browser has no zip and the asset lives in a bucket.
 *   • a link to another chapter becomes a reader navigation rather than a dead
 *     `href` to a file the browser cannot fetch.
 *
 * The book's own CSS is dropped, deliberately. Publisher stylesheets fight the
 * app's typography, assume a fixed viewport, and are the main reason ePub
 * readers look inconsistent from book to book. Chapters render in the reader's
 * own type scale instead.
 */

export type ChapterRewriteOptions = {
  /** Zip path of the chapter being processed — hrefs resolve relative to it. */
  chapterPath: string;
  /** Zip path → spine index, for links that land on another chapter. */
  spineIdxByPath: Map<string, number>;
  /** Builds the URL the browser should fetch an asset from. */
  assetUrl: (zipPath: string) => string;
};

/**
 * Cover pages are routinely a bare SVG wrapping a single `<image>`. SVG is not
 * worth allowing through the sanitizer for one layout idiom, so the wrapper is
 * flattened to a plain `<img>` first and travels the normal image path.
 */
function flattenSvgImages(html: string): string {
  return html.replace(
    /<svg\b[^>]*>[\s\S]*?<image\b[^>]*?(?:xlink:href|href)\s*=\s*["']([^"']+)["'][^>]*>[\s\S]*?<\/svg>/gi,
    (_full, href: string) => `<img src="${href.replace(/"/g, "&quot;")}" alt="" />`,
  );
}

export function prepareChapterHtml(html: string, opts: ChapterRewriteOptions): string {
  const { chapterPath, spineIdxByPath, assetUrl } = opts;

  return sanitizeHtml(flattenSvgImages(html), {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat([
      "img",
      "figure",
      "figcaption",
      "h1",
      "h2",
      "section",
      "article",
      "aside",
      "header",
      "footer",
    ]),
    allowedAttributes: {
      "*": ["id", "lang", "dir"],
      img: ["src", "alt", "title", "width", "height", "loading", "decoding"],
      a: ["href", "target", "rel", "data-book-chapter", "data-book-fragment"],
      td: ["colspan", "rowspan"],
      th: ["colspan", "rowspan", "scope"],
      ol: ["start", "reversed"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    transformTags: {
      img: (_tagName, attribs): sanitizeHtml.Tag => {
        const zipPath = resolveHref(chapterPath, attribs.src ?? "");
        if (!zipPath) {
          // Points outside the book, or nowhere. An <img> with no usable src
          // renders as a broken-image icon, so it becomes an empty span.
          // (A marker attribute plus exclusiveFilter cannot work here:
          // sanitize-html strips attributes it does not allow before the
          // filter ever sees them.)
          return { tagName: "span", attribs: {} };
        }
        const out: Record<string, string> = {
          src: assetUrl(zipPath),
          alt: attribs.alt ?? "",
          loading: "lazy",
          decoding: "async",
        };
        if (attribs.title) out.title = attribs.title;
        return { tagName: "img", attribs: out };
      },

      a: (tagName, attribs): sanitizeHtml.Tag => {
        const href = (attribs.href ?? "").trim();

        // A bare fragment addresses this same chapter; the reader scrolls to it.
        if (href.startsWith("#")) return { tagName, attribs: { href } };

        if (isExternalHref(href)) {
          return {
            tagName,
            attribs: { href, target: "_blank", rel: "noopener noreferrer nofollow" },
          };
        }

        const zipPath = resolveHref(chapterPath, href);
        const idx = zipPath === null ? undefined : spineIdxByPath.get(zipPath);
        if (idx === undefined) {
          // A link into the book that is not a chapter — a stylesheet, an
          // image, a file the manifest forgot. Keep the words, lose the link.
          return { tagName: "span", attribs: {} };
        }

        const { fragment } = splitFragment(href);
        const out: Record<string, string> = { href: "#", "data-book-chapter": String(idx) };
        if (fragment) out["data-book-fragment"] = fragment;
        return { tagName: "a", attribs: out };
      },
    },
    // Drop the contents outright rather than leaking them as loose text. `title`
    // matters most: without it, every chapter would start with the stray words
    // of its <head><title>.
    nonTextTags: ["style", "script", "textarea", "option", "noscript", "title"],
  });
}

// <br> is the only block-ish break not written as a closing tag; without it
// verse and address blocks come out of the extractor as one run-on line.
const BLOCK_END = /<\/(p|div|h[1-6]|li|tr|section|article|blockquote)>|<br\s*\/?>/gi;

/**
 * Plain text of a chapter, for chunking and for the stored character count.
 *
 * This approximates what the browser will put in `textContent` — close enough
 * for a progress percentage, which is all it feeds. The saved reading position
 * is never measured against it: that anchor is computed by walking the rendered
 * DOM and resolved the same way, so it stays internally consistent even where
 * this estimate drifts.
 */
export function chapterText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    .replace(BLOCK_END, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (m, d: string) => {
      // An out-of-range code point throws, and one malformed entity must not
      // take down the ingest of an entire book.
      const code = Number(d);
      return Number.isInteger(code) && code >= 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : m;
    })
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** First heading in a chapter — the last-resort chapter title. */
export function firstHeading(html: string): string | null {
  const m = /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i.exec(html);
  if (!m) return null;
  const text = chapterText(m[1]).replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 200) : null;
}
