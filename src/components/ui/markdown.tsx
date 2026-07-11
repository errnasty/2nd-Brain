"use client";

import { Suspense, lazy } from "react";
import type { Components } from "react-markdown";

// Code-split the unified/micromark pipeline out of the initial bundle of every
// route that renders markdown (/today, /ask, /directory, /rabbithole, readers).
// The type-only import above is erased at build time and costs nothing.
const MarkdownImpl = lazy(() => import("./markdown-impl"));

export type { Components };

/**
 * Drop-in replacement for `<ReactMarkdown remarkPlugins={[remarkGfm]}>`.
 * While the chunk loads (first render only), the raw text shows as
 * whitespace-preserved plain text so streamed AI answers stay readable.
 */
export function Markdown({
  children,
  components,
}: {
  children: string;
  components?: Components;
}) {
  return (
    <Suspense fallback={<div className="whitespace-pre-wrap">{children}</div>}>
      <MarkdownImpl components={components}>{children}</MarkdownImpl>
    </Suspense>
  );
}
