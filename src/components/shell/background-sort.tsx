"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { DIRECTORY_CHANGED_EVENT, resumeOrganizeJob } from "@/lib/ui/organize-job";

/**
 * Keeps a background Directory sort attached to the app, wherever the user is.
 *
 * Two jobs, both of which need to outlive the dialog that started the sort:
 *
 *   - Re-attach on mount, so a reload (or a trip to another page and back)
 *     picks up a sort that is still running instead of losing it silently.
 *   - Refresh the current route when a sort or an undo finishes, so the folder
 *     tree and item list show the new arrangement without the user reloading.
 *
 * Renders nothing, and is mounted once in the app layout beside the progress
 * strip it feeds.
 */
export function BackgroundSort() {
  const router = useRouter();

  useEffect(() => {
    resumeOrganizeJob();
  }, []);

  useEffect(() => {
    const onChange = () => router.refresh();
    window.addEventListener(DIRECTORY_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(DIRECTORY_CHANGED_EVENT, onChange);
  }, [router]);

  return null;
}
