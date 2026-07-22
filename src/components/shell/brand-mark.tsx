import { cn } from "@/lib/utils";

/**
 * The Second Brain mark — a small layered neural net (3 inputs → 1 hidden → 2
 * outputs). Monochrome by design: strokes and nodes use `currentColor`, so the
 * mark inherits its surroundings' text color and works on any theme/palette
 * without variants. This is the simplified "funnel" form used inline at UI
 * sizes; the app-icon assets use the fuller 3×3×2 net.
 *
 * viewBox is 140×120 (wider than tall) to match the wordmark lockup — pass a
 * width via `className` (e.g. `h-4 w-[19px]`) or let it fill its box.
 */
export function BrandMark({ className, title = "Second Brain" }: { className?: string; title?: string }) {
  return (
    <svg
      viewBox="0 0 140 120"
      fill="none"
      role="img"
      aria-label={title}
      className={cn("shrink-0", className)}
    >
      <g stroke="currentColor" strokeWidth={7} strokeLinecap="round">
        <line x1="26" y1="30" x2="70" y2="60" />
        <line x1="26" y1="60" x2="70" y2="60" />
        <line x1="26" y1="90" x2="70" y2="60" />
        <line x1="70" y1="60" x2="114" y2="45" />
        <line x1="70" y1="60" x2="114" y2="75" />
      </g>
      <g fill="currentColor">
        <circle cx="26" cy="30" r="12" />
        <circle cx="26" cy="60" r="12" />
        <circle cx="26" cy="90" r="12" />
        <circle cx="70" cy="60" r="14" />
        <circle cx="114" cy="45" r="12" />
        <circle cx="114" cy="75" r="12" />
      </g>
    </svg>
  );
}
