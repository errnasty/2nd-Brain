"use client";

// Client-only UI preferences, persisted in localStorage and applied to the
// document root. Theme is handled separately by next-themes.

export const FONT_SCALE_KEY = "app.fontScale.v1"; // percentage, e.g. "100"
export const REDUCE_MOTION_KEY = "app.reduceMotion.v1"; // "true" | "false"

export const FONT_SCALE_MIN = 85;
export const FONT_SCALE_MAX = 130;
export const FONT_SCALE_DEFAULT = 100;

export function getFontScale(): number {
  if (typeof window === "undefined") return FONT_SCALE_DEFAULT;
  const raw = Number(localStorage.getItem(FONT_SCALE_KEY));
  if (!raw || Number.isNaN(raw)) return FONT_SCALE_DEFAULT;
  return Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, raw));
}

export function applyFontScale(pct: number) {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty("--app-font-scale", `${pct}%`);
}

export function setFontScale(pct: number) {
  const clamped = Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, Math.round(pct)));
  localStorage.setItem(FONT_SCALE_KEY, String(clamped));
  applyFontScale(clamped);
}

export function getReduceMotion(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(REDUCE_MOTION_KEY) === "true";
}

export function applyReduceMotion(on: boolean) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-reduce-motion", on ? "true" : "false");
}

export function setReduceMotion(on: boolean) {
  localStorage.setItem(REDUCE_MOTION_KEY, String(on));
  applyReduceMotion(on);
}

/** Apply persisted prefs to the document. Call once on app mount. */
export function applyStoredSettings() {
  applyFontScale(getFontScale());
  applyReduceMotion(getReduceMotion());
}
