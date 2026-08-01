import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

/**
 * The real markdown renderer. Kept in its own module so `markdown.tsx` can
 * lazy-load it: react-markdown + remark-gfm pull the whole unified/micromark
 * pipeline, which must stay out of every route's initial bundle.
 *
 * `rehype-highlight` lives here for the same reason — it bundles highlight.js,
 * which is far too heavy for an initial bundle but costs nothing extra inside a
 * chunk that only loads when markdown is actually on screen.
 *
 * The plugin only adds `hljs-*` CLASSES; every colour comes from the palette in
 * `globals.css`, which is what makes one highlighter serve both light and dark
 * themes. Importing a highlight.js stylesheet instead would hard-code one
 * theme's colours and force a second stylesheet (and a flash) for the other.
 */
export default function MarkdownImpl({
  children,
  components,
}: {
  children: string;
  components?: Components;
}) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[
        [
          rehypeHighlight,
          {
            // A language the bundle doesn't know must render as plain text, not
            // throw — user notes contain fenced blocks labelled anything at all.
            ignoreMissing: true,
            // Don't guess. Auto-detection on a short unlabelled block is
            // frequently wrong, and wrong highlighting reads worse than none:
            // it colours tokens as things they aren't.
            detect: false,
          },
        ],
      ]}
      components={components}
    >
      {children}
    </ReactMarkdown>
  );
}
