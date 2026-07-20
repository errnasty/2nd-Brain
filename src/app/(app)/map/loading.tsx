import { Spinner } from "@/components/ui/spinner";

/** Shown during navigation into /map while the knowledge graph loads. */
export default function MapLoading() {
  return (
    <div className="flex h-full items-center justify-center">
      <Spinner className="h-6 w-6 text-muted-foreground" />
    </div>
  );
}
