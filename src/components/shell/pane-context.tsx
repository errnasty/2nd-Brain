"use client";

import { createContext, useContext } from "react";

/**
 * Lets a deeply-nested reader/viewer header drive the ResizableShell's nav
 * (secondary) pane without threading props through the whole tree. Only the
 * ResizableShell provides a real value; everywhere else falls back to the inert
 * default (navControllable=false), so components that read this render safely
 * on pages that have no resizable nav (e.g. /study).
 */
export type PaneChrome = {
  /** True when the secondary nav pane is currently collapsed. */
  navCollapsed: boolean;
  /** Collapse ⇄ expand the secondary nav pane. */
  toggleNav: () => void;
  /** False when there is no controllable nav pane (mobile, or no shell) — the
   *  reader should hide its nav toggle rather than render a dead button. */
  navControllable: boolean;
};

const PaneChromeContext = createContext<PaneChrome>({
  navCollapsed: false,
  toggleNav: () => {},
  navControllable: false,
});

export const PaneChromeProvider = PaneChromeContext.Provider;

export function usePaneChrome(): PaneChrome {
  return useContext(PaneChromeContext);
}
