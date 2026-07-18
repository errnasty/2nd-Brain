import { Skeleton } from "@/components/ui/skeleton";

/** Shown during navigation into /documents while the document list loads. */
export default function DocumentsLoading() {
  return (
    <div className="flex h-full w-full overflow-hidden">
      <section className="flex w-full flex-col border-r border-border lg:max-w-sm lg:shrink-0">
        <div className="p-3">
          <Skeleton className="h-24 w-full rounded-lg" />
        </div>
        <div className="h-px bg-border" />
        <ul className="divide-y divide-border">
          {Array.from({ length: 7 }).map((_, i) => (
            <li key={i} className="space-y-2 p-3">
              <div className="flex items-center gap-1.5">
                <Skeleton className="h-3 w-3 rounded" />
                <Skeleton className="h-3 w-12" />
              </div>
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-3 w-1/3" />
            </li>
          ))}
        </ul>
      </section>
      <section className="hidden flex-1 items-center justify-center text-sm text-muted-foreground lg:flex">
        Loading…
      </section>
    </div>
  );
}
