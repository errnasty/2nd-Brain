import { Skeleton } from "@/components/ui/skeleton";

export default function FeedsLoading() {
  return (
    <>
      <section className="hidden w-full max-w-sm shrink-0 flex-col border-r border-border lg:flex">
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
