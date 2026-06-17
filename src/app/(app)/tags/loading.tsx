import { Skeleton } from "@/components/ui/skeleton";

/** Shown during navigation into /tags while tags + usage counts load. */
export default function TagsLoading() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <Skeleton className="h-8 w-28" />
        <Skeleton className="mt-2 h-4 w-64" />
        <div className="mt-8 divide-y divide-border">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between gap-4 py-3">
              <div className="flex items-center gap-3">
                <Skeleton className="h-4 w-4 rounded" />
                <Skeleton className="h-4 w-32" />
              </div>
              <Skeleton className="h-3 w-10" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
