import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The app-wide spinner. Every loading state should render this (directly or
 * via LoadingButton/BusyOverlay) rather than importing Loader2 ad hoc, so
 * pending feedback stays visually consistent.
 */
export function Spinner({ className }: { className?: string }) {
  return <Loader2 aria-hidden className={cn("h-4 w-4 animate-spin", className)} />;
}
