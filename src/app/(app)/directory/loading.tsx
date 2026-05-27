import { Skeleton } from "@/components/ui/skeleton";

/**
 * Rendered by Next.js during route transitions into /directory. Shape mirrors
 * the real Directory list so the page doesn't visually pop on load.
 */
export default function DirectoryLoading() {
  return (
    <section className="hidden w-full max-w-sm shrink-0 flex-col border-r border-border md:flex">
      <div className="flex items-center justify-between px-3 py-3">
        <Skeleton className="h-4 w-24" />
        <div className="flex gap-1">
          <Skeleton className="h-7 w-7 rounded" />
          <Skeleton className="h-7 w-7 rounded" />
        </div>
      </div>
      <div className="h-px bg-border" />
      <ul className="divide-y divide-border">
        {Array.from({ length: 8 }).map((_, i) => (
          <li key={i} className="px-4 py-3">
            <div className="mb-1.5 flex items-center gap-1.5">
              <Skeleton className="h-3 w-3 rounded-sm" />
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-3 w-12" />
            </div>
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="mt-2 h-3 w-full" />
            <Skeleton className="mt-1 h-3 w-3/4" />
          </li>
        ))}
      </ul>
    </section>
  );
}
