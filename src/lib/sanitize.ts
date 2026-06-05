import sanitizeHtml from "sanitize-html";

/**
 * Clean untrusted article/document HTML before it is ever rendered with
 * dangerouslySetInnerHTML. RSS full-text comes from arbitrary third-party
 * sites — without this a feed could inject <script>/onerror payloads that run
 * in the user's session. Strips scripts, event handlers, iframes, and unsafe
 * URL schemes while keeping normal reading markup (headings, lists, images,
 * links, blockquotes, code, tables).
 */
export function cleanHtml(dirty: string | null | undefined): string {
  if (!dirty) return "";
  return sanitizeHtml(dirty, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat([
      "img",
      "figure",
      "figcaption",
      "h1",
      "h2",
      "picture",
      "source",
    ]),
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      img: ["src", "srcset", "alt", "title", "width", "height", "loading", "decoding"],
      source: ["src", "srcset", "type", "media"],
      a: ["href", "name", "target", "rel"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    transformTags: {
      // Force safe link behavior and drop tracking-ish protocol-relative oddities.
      a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer nofollow", target: "_blank" }),
      // Body images come from arbitrary feeds at full size. Force off-screen
      // lazy-load + async decode so a long article doesn't fetch/decode every
      // image up front and block the main thread.
      img: sanitizeHtml.simpleTransform("img", { loading: "lazy", decoding: "async" }),
    },
    // Drop the entire contents of these rather than leaving stray text.
    nonTextTags: ["style", "script", "textarea", "option", "noscript"],
  });
}
