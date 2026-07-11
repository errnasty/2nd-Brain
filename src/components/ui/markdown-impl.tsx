import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * The real markdown renderer. Kept in its own module so `markdown.tsx` can
 * lazy-load it: react-markdown + remark-gfm pull the whole unified/micromark
 * pipeline, which must stay out of every route's initial bundle.
 */
export default function MarkdownImpl({
  children,
  components,
}: {
  children: string;
  components?: Components;
}) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {children}
    </ReactMarkdown>
  );
}
