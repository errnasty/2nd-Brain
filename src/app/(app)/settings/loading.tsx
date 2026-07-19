import { Skeleton } from "@/components/ui/skeleton";

/** Shown during navigation into /settings while settings load. */
export default function SettingsLoading() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-6 py-10">
        <div className="editorial-rule mb-8 pb-4">
          <Skeleton className="mb-2 h-3 w-32" />
          <Skeleton className="h-9 w-44" />
        </div>
        <div className="space-y-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-3 rounded-xl border border-border p-5">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-9 w-full rounded-md" />
              <Skeleton className="h-9 w-2/3 rounded-md" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
