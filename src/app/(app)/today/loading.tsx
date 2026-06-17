import { Skeleton } from "@/components/ui/skeleton";

/** Shown during navigation into /today while the brief + counts load. */
export default function TodayLoading() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-8">
        <div className="mb-6 flex items-center justify-between">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-8 w-24 rounded-md" />
        </div>
        <div className="space-y-3 rounded-xl border border-border p-5">
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-full" />
        </div>
        <div className="mt-6 space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 rounded-md border border-border p-3">
              <Skeleton className="h-4 w-4 rounded" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
