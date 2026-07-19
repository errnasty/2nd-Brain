import { Skeleton } from "@/components/ui/skeleton";

/** Shown while a deck (reader or build progress) loads. */
export default function DeckLoading() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <Skeleton className="h-8 w-8 rounded-md" />
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-4 w-56" />
          <Skeleton className="h-2.5 w-40" />
        </div>
      </div>
      <div className="flex flex-1 justify-center px-6 py-8">
        <div className="w-full max-w-xl space-y-4">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      </div>
    </div>
  );
}
