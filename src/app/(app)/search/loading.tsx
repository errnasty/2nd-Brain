import { Skeleton } from "@/components/ui/skeleton";

/** Shown during navigation into /search (and between query submits). */
export default function SearchLoading() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-6 py-10">
        <div className="editorial-rule mb-6 pb-4">
          <Skeleton className="mb-2 h-3 w-28" />
          <Skeleton className="h-9 w-40" />
        </div>
        <Skeleton className="h-10 w-full rounded-md" />
        <div className="mt-3 flex gap-1.5">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-6 w-24 rounded-full" />
          ))}
        </div>
      </div>
    </div>
  );
}
