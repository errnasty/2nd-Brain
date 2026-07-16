import { Skeleton } from "@/components/ui/skeleton";

/** Shown during navigation into /study while stats/tasks/cards/calendar load. */
export default function StudyLoading() {
  return (
    <div className="flex h-full flex-col">
      {/* Tab bar */}
      <div className="flex items-center gap-1 border-b border-border px-3 py-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-24 rounded-md" />
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-6 py-8">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="space-y-2 rounded-lg border border-border p-4">
                <Skeleton className="h-3 w-1/2" />
                <Skeleton className="h-7 w-12" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
