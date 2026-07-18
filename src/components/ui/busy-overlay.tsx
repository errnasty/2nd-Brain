import { Spinner } from "@/components/ui/spinner";

/**
 * Overlay for multi-second operations (AI generation, imports) where a button
 * spinner under-communicates. Covers the nearest positioned ancestor with a
 * translucent scrim and a centered spinner + label.
 */
export function BusyOverlay({ show, label }: { show: boolean; label: string }) {
  if (!show) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="absolute inset-0 z-20 flex items-center justify-center rounded-[inherit] bg-background/70 backdrop-blur-[2px] motion-safe:animate-in motion-safe:fade-in-0"
    >
      <div className="flex items-center gap-2.5 rounded-lg border border-border bg-card px-4 py-3 shadow-sm">
        <Spinner className="text-brand" />
        <span className="text-sm text-muted-foreground">{label}</span>
      </div>
    </div>
  );
}
