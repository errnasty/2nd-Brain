"use client";

import { useEffect } from "react";

type Handler = (e: KeyboardEvent) => void;
type ShortcutMap = Record<string, Handler>;

function isEditable(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}

/**
 * Inoreader-style keyboard shortcuts. Pass a map of `key` (lowercase) to handler.
 * Ignores presses while the user is typing in inputs / contenteditables.
 *
 * Example: `useShortcuts({ j: next, k: prev, m: toggleRead, escape: close })`
 */
export function useShortcuts(shortcuts: ShortcutMap, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isEditable(e.target)) return;
      const key = e.key.toLowerCase();
      const handler = shortcuts[key];
      if (handler) {
        e.preventDefault();
        handler(e);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shortcuts, enabled]);
}
