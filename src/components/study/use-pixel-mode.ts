"use client";

import { useCallback, useEffect, useState } from "react";
import { updateUserSettingsAction } from "@/lib/settings/actions";

/**
 * Whether the game layer renders as a pixel-art console or as ordinary UI.
 *
 * A SKIN, not a mode: both renderings read the same `GameState` and show the
 * same numbers. Nothing is only available in one of them, so switching can
 * never hide progress or make a stat unreachable — which is what makes it safe
 * to leave the plain rendering as the default and let the pixel look be a
 * choice rather than something imposed on every visit.
 *
 * Local-first, same shape as `useListCollapse`: the toggle has to feel
 * instant, and a skin preference is not worth a server round trip. It defaults
 * OFF on the server and on first paint so SSR markup matches, then adopts the
 * stored value after mount. The server copy is written too, so the choice
 * follows you to another device — best-effort, since failing to persist a
 * cosmetic preference must never surface as an error.
 */
const STORAGE_KEY = "study.pixelMode.v1";

export function usePixelMode(initial = false): [boolean, () => void] {
  const [pixel, setPixel] = useState(initial);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored !== null) setPixel(stored === "1");
    } catch {
      /* localStorage unavailable — keep the server-provided value */
    }
  }, []);

  const toggle = useCallback(() => {
    setPixel((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* ignore quota/availability */
      }
      void updateUserSettingsAction({ pixelMode: next }).catch(() => {
        // The local value already applied; a failed sync just means this
        // device keeps the preference and others don't.
      });
      return next;
    });
  }, []);

  return [pixel, toggle];
}
