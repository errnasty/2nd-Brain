import { Skeleton } from "@/components/ui/skeleton";

/** Shown during navigation into /ask while the chat shell loads. */
export default function AskLoading() {
  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col px-6 py-10">
      <div className="editorial-rule mb-8 pb-4">
        <Skeleton className="mb-2 h-3 w-24" />
        <Skeleton className="h-9 w-36" />
      </div>
      <div className="flex-1" />
      <Skeleton className="h-12 w-full rounded-xl" />
    </div>
  );
}
