"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Persisted "is the list (third) pane collapsed" toggle. Defaults to expanded
 * on the server / first paint (so SSR markup matches), then hydrates the stored
 * value after mount. Shared by the Directory and Feeds shells.
 */
export function useListCollapse(storageKey: string): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(storageKey) === "1");
    } catch {
      /* localStorage unavailable — stay expanded */
    }
  }, [storageKey]);

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(storageKey, next ? "1" : "0");
      } catch {
        /* ignore quota/availability */
      }
      return next;
    });
  }, [storageKey]);

  return [collapsed, toggle];
}
