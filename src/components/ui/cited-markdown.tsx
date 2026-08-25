"use client";

import { Markdown, type Components } from "@/components/ui/markdown";

export type Citation = {
  /** The number as it appears in the text. */
  n: number;
  /**
   * Marker before the number, for references that live in their own numbering
   * space. The Daily Brief's "outside your feeds" section cites `[E1]`, `[E2]`
   * because those stories are NOT in the user's queue — reusing plain `[1]`
   * would silently resolve to whichever article happens to be first.
   */
  prefix?: "E";
  /** Where the chip goes: an in-app path, or an absolute URL when `external`. */
  href: string;
  title?: string;
  /** Open in a new tab instead of routing in-app. */
  external?: boolean;
};

const keyOf = (c: Pick<Citation, "n" | "prefix">) => `${c.prefix ?? ""}${c.n}`;

/**
 * Markdown that turns the model's `[1]`, `[2]`, `[E1]` references into tappable
 * inline citation chips linking to the cited source, instead of a plain footer
 * list. Shared by the Daily Brief and Ask. Only references with a matching
 * citation are linked; everything else renders as normal markdown.
 *
 * `onNavigate` handles in-app routing (so the click stays a client navigation);
 * citations marked `external` render as a normal new-tab anchor, because they
 * point at the open web rather than anything the app holds.
 *
 * `onInspect` opts a caller into a different behaviour for in-app citations:
 * the chip reports the click instead of navigating, so the caller can answer
 * "why is this here" before deciding to open anything. The Daily Brief uses it
 * — it is the one surface that knows why each source was chosen. Ask does not,
 * and keeps navigating on a tap, which is what it means there.
 */
export function CitedMarkdown({
  children,
  citations,
  onNavigate,
  onInspect,
}: {
  children: string;
  citations: Citation[];
  onNavigate: (href: string) => void;
  onInspect?: (citation: Citation, anchor: HTMLElement) => void;
}) {
  const byKey = new Map(citations.map((c) => [keyOf(c), c]));
  const content =
    citations.length > 0
      ? children.replace(/\[(E?\d+)\]/g, (m: string, ref: string) =>
          byKey.has(ref) ? `[${m}](#cite-${ref})` : m,
        )
      : children;

  const components: Components = {
    a: ({ href, children: kids }) => {
      if (href && href.startsWith("#cite-")) {
        const c = byKey.get(href.slice("#cite-".length));
        if (c) {
          const className =
            "mx-0.5 rounded bg-brand/10 px-1 align-baseline font-mono text-[0.82em] text-brand no-underline transition-colors hover:bg-brand/20";
          if (c.external) {
            return (
              <a
                href={c.href}
                target="_blank"
                rel="noopener noreferrer"
                className={className}
                title={c.title ? `Open: ${c.title}` : "Open source"}
              >
                {kids}
              </a>
            );
          }
          return (
            <button
              type="button"
              onClick={(e) =>
                onInspect ? onInspect(c, e.currentTarget) : onNavigate(c.href)
              }
              className={className}
              title={c.title ? (onInspect ? c.title : `Open: ${c.title}`) : "Open source"}
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
