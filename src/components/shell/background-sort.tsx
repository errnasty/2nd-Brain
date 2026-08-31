"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  DIRECTORY_CHANGED_EVENT,
  SORT_REPORT_EVENT,
  resumeOrganizeJob,
} from "@/lib/ui/organize-job";

// Opened from a toast, minutes after the page loaded and only if the reader
// asks — so it is fetched then rather than shipped with every app boot.
const SortReportDialog = dynamic(
  () => import("@/components/directory/sort-report-dialog").then((m) => m.SortReportDialog),
  { ssr: false },
);

/**
 * Keeps a background Directory sort attached to the app, wherever the user is.
 *
 * Three jobs, all of which need to outlive the dialog that started the sort:
 *
 *   - Re-attach on mount, so a reload (or a trip to another page and back)
 *     picks up a sort that is still running instead of losing it silently.
 *   - Refresh the current route when a sort or an undo finishes, so the folder
 *     tree and item list show the new arrangement without the user reloading.
 *   - Host the "where everything went" dialog. It is opened from the completion
 *     toast, which is not part of any React tree and so can only ask for it by
 *     event; mounting the host here means the request works from any page.
 *
 * Renders nothing until that dialog is asked for, and is mounted once in the
 * app layout beside the progress strip it feeds.
 */
export function BackgroundSort() {
  const router = useRouter();
  const [reportJobId, setReportJobId] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);

  useEffect(() => {
    resumeOrganizeJob();
  }, []);

  useEffect(() => {
    const onChange = () => router.refresh();
    const onReport = (e: Event) => {
      const jobId = (e as CustomEvent<string>).detail;
      if (!jobId) return;
      setReportJobId(jobId);
      setReportOpen(true);
    };
    window.addEventListener(DIRECTORY_CHANGED_EVENT, onChange);
    window.addEventListener(SORT_REPORT_EVENT, onReport);
    return () => {
      window.removeEventListener(DIRECTORY_CHANGED_EVENT, onChange);
      window.removeEventListener(SORT_REPORT_EVENT, onReport);
    };
  }, [router]);

  if (!reportJobId) return null;
  return <SortReportDialog jobId={reportJobId} open={reportOpen} onOpenChange={setReportOpen} />;
}
