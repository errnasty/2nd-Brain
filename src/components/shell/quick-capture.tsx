"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

// Quick capture pulls in the dialog, form controls and the Directory server
// actions — dead weight in the layout chunk on every route until someone
// actually captures something.
const QuickCaptureImpl = dynamic(() =>
  import("./quick-capture-impl").then((m) => m.QuickCaptureImpl),
);

/**
 * Thin, always-mounted trigger for quick capture. It owns the
 * `open-quick-capture` event (dispatched by the `c` shortcut, the command
 * palette and the mobile + button) so the first open never misses, then mounts
 * the real dialog. The chunk is warmed on idle so that open feels instant.
 */
export function QuickCapture() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // After mount the dialog's own listener takes over; this only catches the
    // first open, before the chunk exists.
    function onOpen() {
      setMounted(true);
    }
    window.addEventListener("open-quick-capture", onOpen);
    return () => window.removeEventListener("open-quick-capture", onOpen);
  }, []);

  useEffect(() => {
    const warm = () => void import("./quick-capture-impl");
    const ric = window.requestIdleCallback;
    if (typeof ric === "function") {
      const handle = ric(warm, { timeout: 4000 });
      return () => window.cancelIdleCallback?.(handle);
    }
    const handle = window.setTimeout(warm, 2000);
    return () => window.clearTimeout(handle);
  }, []);

  return mounted ? <QuickCaptureImpl initialOpen /> : null;
}
