import { Skeleton } from "@/components/ui/skeleton";

/** Shown during navigation into /thinktank while decks load. */
export default function ThinkTankLoading() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-6 py-10">
        <div className="editorial-rule mb-8 pb-4">
          <Skeleton className="mb-2 h-3 w-32" />
          <Skeleton className="h-9 w-48" />
        </div>
        <Skeleton className="h-10 w-full rounded-md" />
        <div className="mt-3 flex gap-1.5">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-6 w-20 rounded-full" />
          ))}
        </div>
        <div className="mt-8 space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-2 rounded-lg border border-border p-4">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
