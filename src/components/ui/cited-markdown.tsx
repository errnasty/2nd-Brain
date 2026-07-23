"use client";

import { Markdown, type Components } from "@/components/ui/markdown";

export type Citation = {
  /** The [n] number as it appears in the text. */
  n: number;
  /** In-app path to open when the chip is tapped (e.g. /directory?item=…). */
  href: string;
  title?: string;
};

/**
 * Markdown that turns the model's `[1]`, `[2]` references into tappable inline
 * citation chips linking to the cited source, instead of a plain footer list.
 * Shared by the Daily Brief and Ask. Only `[n]` values with a matching
 * citation are linked; everything else renders as normal markdown.
 *
 * `onNavigate` handles in-app routing (so the click stays a client navigation);
 * external links fall through to a normal new-tab anchor.
 */
export function CitedMarkdown({
  children,
  citations,
  onNavigate,
}: {
  children: string;
  citations: Citation[];
  onNavigate: (href: string) => void;
}) {
  const byN = new Map(citations.map((c) => [c.n, c]));
  const content =
    citations.length > 0
      ? children.replace(/\[(\d+)\]/g, (m: string, num: string) =>
          byN.has(Number(num)) ? `[${m}](#cite-${num})` : m,
        )
      : children;

  const components: Components = {
    a: ({ href, children: kids }) => {
      if (href && href.startsWith("#cite-")) {
        const c = byN.get(Number(href.slice("#cite-".length)));
        if (c) {
          return (
            <button
              type="button"
              onClick={() => onNavigate(c.href)}
              className="mx-0.5 rounded bg-brand/10 px-1 align-baseline font-mono text-[0.82em] text-brand no-underline transition-colors hover:bg-brand/20"
              title={c.title ? `Open: ${c.title}` : "Open source"}
            >
              {kids}
            </button>
          );
        }
      }
      return (
        <a href={href} target="_blank" rel="noopener noreferrer">
          {kids}
        </a>
      );
    },
  };

  return <Markdown components={components}>{content}</Markdown>;
}
