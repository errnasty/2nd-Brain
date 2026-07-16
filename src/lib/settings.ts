"use client";

// Client-only UI preferences, persisted in localStorage and applied to the
// document root. Theme is handled separately by next-themes.

export const FONT_SCALE_KEY = "app.fontScale.v1"; // percentage, e.g. "100"
export const REDUCE_MOTION_KEY = "app.reduceMotion.v1"; // "true" | "false"
export const FONT_FAMILY_KEY = "app.fontFamily.v1"; // FontId
export const PALETTE_KEY = "app.palette.v1"; // PaletteId

// Colour palette (orthogonal to light/dark — each works in both). Applied as a
// `data-palette` attribute on <html>; the CSS lives in globals.css. `parchment`
// is the built-in default (no attribute override needed) — a pre-paint inline
// script in the root layout sets the attribute before first paint to avoid a
// palette flash, mirroring how next-themes handles the light/dark class.
export type PaletteId = "parchment" | "mono" | "ocean" | "forest";

export const PALETTE_OPTIONS: { id: PaletteId; label: string }[] = [
  { id: "parchment", label: "Parchment" },
  { id: "mono", label: "Black & white" },
  { id: "ocean", label: "Ocean" },
  { id: "forest", label: "Forest" },
];

export const PALETTE_DEFAULT: PaletteId = "parchment";

export function getPalette(): PaletteId {
  if (typeof window === "undefined") return PALETTE_DEFAULT;
  const raw = localStorage.getItem(PALETTE_KEY) as PaletteId | null;
  return raw && PALETTE_OPTIONS.some((p) => p.id === raw) ? raw : PALETTE_DEFAULT;
}

export function applyPalette(id: PaletteId) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-palette", id);
}

export function setPalette(id: PaletteId) {
  localStorage.setItem(PALETTE_KEY, id);
  applyPalette(id);
}

// Body font options. The non-system fonts are loaded by next/font in the root
// layout, which exposes them as CSS variables (--font-crimson etc.); the stack
// references those with a Georgia/system fallback so text never goes invisible.
export type FontId = "georgia" | "crimson" | "lora" | "dmsans";

export const FONT_OPTIONS: { id: FontId; label: string; kind: "Serif" | "Sans"; stack: string }[] = [
  { id: "georgia", label: "Georgia", kind: "Serif", stack: 'Georgia, "Times New Roman", serif' },
  { id: "crimson", label: "Crimson Pro", kind: "Serif", stack: 'var(--font-crimson), Georgia, serif' },
  { id: "lora", label: "Lora", kind: "Serif", stack: 'var(--font-lora), Georgia, serif' },
  { id: "dmsans", label: "DM Sans", kind: "Sans", stack: 'var(--font-dm-sans), system-ui, sans-serif' },
];

export const FONT_FAMILY_DEFAULT: FontId = "georgia";

function fontStack(id: FontId): string {
  return (FONT_OPTIONS.find((f) => f.id === id) ?? FONT_OPTIONS[0]).stack;
}

export function getFontFamily(): FontId {
  if (typeof window === "undefined") return FONT_FAMILY_DEFAULT;
  const raw = localStorage.getItem(FONT_FAMILY_KEY) as FontId | null;
  return raw && FONT_OPTIONS.some((f) => f.id === raw) ? raw : FONT_FAMILY_DEFAULT;
}

export function applyFontFamily(id: FontId) {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty("--app-font-body", fontStack(id));
}

export function setFontFamily(id: FontId) {
  localStorage.setItem(FONT_FAMILY_KEY, id);
  applyFontFamily(id);
}

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
  applyFontFamily(getFontFamily());
  applyPalette(getPalette());
}
