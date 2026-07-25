"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

// The palette is ~360 lines of dialog, 20 icons and a search action that most
// page views never open, yet it sat in the layout chunk every route pays for.
// Loading it through next/dynamic keeps it out of that chunk.
const CommandPaletteImpl = dynamic(() =>
  import("./command-palette-impl").then((m) => m.CommandPaletteImpl),
);

/**
 * Thin, always-mounted trigger for the ⌘K palette. It owns the shortcut and the
 * `open-command-palette` event so the first press never misses, and only then
 * mounts the real palette. The chunk is also warmed on idle, so opening it
 * still feels instant on a cold session.
 */
export function CommandPalette() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // Once the palette is mounted its own listeners take over; these only have
    // to catch the very first open, before the chunk exists.
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setMounted(true);
      }
    }
    function onOpen() {
      setMounted(true);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("open-command-palette", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("open-command-palette", onOpen);
    };
  }, []);

  // Warm the chunk once the page is idle: off the critical path, but already
  // in cache by the time anyone reaches for ⌘K.
  useEffect(() => {
    const warm = () => void import("./command-palette-impl");
    const ric = window.requestIdleCallback;
    if (typeof ric === "function") {
      const handle = ric(warm, { timeout: 4000 });
      return () => window.cancelIdleCallback?.(handle);
    }
    const handle = window.setTimeout(warm, 2000);
    return () => window.clearTimeout(handle);
  }, []);

  return mounted ? <CommandPaletteImpl initialOpen /> : null;
}
