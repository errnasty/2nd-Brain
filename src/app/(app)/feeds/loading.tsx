import { Skeleton } from "@/components/ui/skeleton";

/**
 * Rendered by Next.js during route transitions into /feeds — including every
 * switch into a folder or feed, which on a large library is the slowest
 * navigation in the app.
 *
 * The list section must stay visible at ALL widths. It used to be
 * `hidden … lg:flex`, like the desktop-only detail pane below it, which meant
 * a phone got an empty page for the entire duration of that navigation: header
 * and tab bar, nothing between them. It read as "the app is broken and didn't
 * load" rather than "this is loading", and the natural response — reloading —
 * threw away the in-flight request and started the wait over.
 *
 * Only the second pane is desktop-only: on mobile the detail view is a
 * separate screen, so there is nothing there to hold a place for.
 */
export default function FeedsLoading() {
  return (
    <>
      <section className="flex w-full flex-col border-r border-border lg:max-w-sm lg:shrink-0">
        <div className="space-y-3 p-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-3 w-1/3" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-3 w-4/5" />
            </div>
          ))}
        </div>
      </section>
      <section className="hidden flex-1 items-center justify-center text-sm text-muted-foreground lg:flex">
        Loading…
      </section>
    </>
  );
}
