"use client";

// Client-only UI preferences, persisted in localStorage and applied to the
// document root. Theme is handled separately by next-themes.
//
// Keys are scoped per signed-in account (see scopedKey) so two people sharing
// a browser don't share appearance settings or model choices. Real content is
// already user-partitioned server-side; this closes the client-prefs gap.

export const FONT_SCALE_KEY = "app.fontScale.v1"; // percentage, e.g. "100"
export const REDUCE_MOTION_KEY = "app.reduceMotion.v1"; // "true" | "false"
export const FONT_FAMILY_KEY = "app.fontFamily.v1"; // FontId
export const PALETTE_KEY = "app.palette.v1"; // PaletteId
export const ASK_MODEL_KEY = "ask.model.v1"; // shared by Ask / reader panels

/** Marker naming the account whose scoped prefs are active in this browser. */
export const ACTIVE_USER_KEY = "app.activeUser.v1";
/** One-shot flag: which account inherited the pre-scoping (legacy) prefs. */
const LEGACY_CLAIMED_KEY = "app.prefsClaimed.v1";

// Every per-user pref key. Used for the one-time legacy migration on login.
const SCOPED_PREF_KEYS = [
  PALETTE_KEY,
  FONT_FAMILY_KEY,
  FONT_SCALE_KEY,
  REDUCE_MOTION_KEY,
  ASK_MODEL_KEY,
  "sidebar.volumeNumber.v1",
];

/** Short stable hash of the user id — enough to namespace localStorage keys
 *  without writing the raw uuid into a shared browser profile. */
function userHash(userId: string): string {
  let h = 5381;
  for (let i = 0; i < userId.length; i++) h = ((h << 5) + h + userId.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export function getActiveUserHash(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(ACTIVE_USER_KEY);
  } catch {
    return null;
  }
}

/** `base` for signed-out pages; `base.u_<hash>` once an account is active. */
export function scopedKey(base: string): string {
  const hash = getActiveUserHash();
  return hash ? `${base}.u_${hash}` : base;
}

/**
 * Record which account owns this browser session's prefs. The first account
 * ever marked active inherits the old un-scoped values (people upgrading keep
 * their look); every later account starts from defaults. Call on login/signup
 * and from the app shell (covers sessions that predate scoping).
 */
export function setActiveUser(userId: string) {
  if (typeof window === "undefined") return;
  try {
    const hash = userHash(userId);
    localStorage.setItem(ACTIVE_USER_KEY, hash);
    const claimed = localStorage.getItem(LEGACY_CLAIMED_KEY);
    if (claimed && claimed !== hash) return;
    localStorage.setItem(LEGACY_CLAIMED_KEY, hash);
    for (const base of SCOPED_PREF_KEYS) {
      const legacy = localStorage.getItem(base);
      if (legacy !== null && localStorage.getItem(`${base}.u_${hash}`) === null) {
        localStorage.setItem(`${base}.u_${hash}`, legacy);
      }
    }
  } catch {
    // localStorage unavailable — prefs just stay session-default.
  }
}

/** Forget the active account (sign-out). Scoped prefs stay in place so the
 *  account gets its look back instantly on the next sign-in. */
export function clearActiveUser() {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(ACTIVE_USER_KEY);
  } catch {
    // ignore
  }
}

/** Read/write a per-user pref by its base key. */
export function getScopedItem(base: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(scopedKey(base));
  } catch {
    return null;
  }
}

export function setScopedItem(base: string, value: string) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(scopedKey(base), value);
  } catch {
    // ignore
  }
}

// Colour palette (orthogonal to light/dark — each works in both). Applied as a
// `data-palette` attribute on <html>; the CSS lives in globals.css. `parchment`
// is the built-in default (no attribute override needed) — a pre-paint inline
// script in the root layout sets the attribute before first paint to avoid a
// palette flash, mirroring how next-themes handles the light/dark class.
export type PaletteId =
  | "parchment"
  | "mono"
  | "ocean"
  | "forest"
  | "soft-beach"
  | "purple90s"
  | "bright-power";

export const PALETTE_OPTIONS: { id: PaletteId; label: string; swatches?: string[] }[] = [
  { id: "parchment", label: "Parchment" },
  { id: "mono", label: "Black & white" },
  { id: "ocean", label: "Ocean" },
  { id: "forest", label: "Forest" },
  {
    id: "soft-beach",
    label: "Soft Beach",
    // Literal 5-colour reference palette ("Minimal Colors, Soft Beach" by
    // Duminda Perera) — shown as-is in the picker so more than one colour is
    // visible per theme, not just the single derived --brand accent.
    swatches: ["#51e2f5", "#9df9ef", "#edf756", "#ffa8b6", "#a28089"],
  },
  {
    id: "purple90s",
    label: "Purple 90's",
    // "Minimal Colors – Purple 90's Color Scheme" (Purple Blue, Slate White)
    // by Duminda Perera.
    swatches: ["#a0d2eb", "#e5eaf5", "#d0bdf4", "#8458b3", "#a28089"],
  },
  {
    id: "bright-power",
    label: "Bright Power",
    // "Bright Power" by Duminda Perera.
    swatches: ["#ff1d58", "#f75990", "#fff685", "#00ddff", "#0049b7"],
  },
];

export const PALETTE_DEFAULT: PaletteId = "parchment";

export function getPalette(): PaletteId {
  const raw = getScopedItem(PALETTE_KEY) as PaletteId | null;
  return raw && PALETTE_OPTIONS.some((p) => p.id === raw) ? raw : PALETTE_DEFAULT;
}

export function applyPalette(id: PaletteId) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-palette", id);
}

export function setPalette(id: PaletteId) {
  setScopedItem(PALETTE_KEY, id);
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
  const raw = getScopedItem(FONT_FAMILY_KEY) as FontId | null;
  return raw && FONT_OPTIONS.some((f) => f.id === raw) ? raw : FONT_FAMILY_DEFAULT;
}

export function applyFontFamily(id: FontId) {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty("--app-font-body", fontStack(id));
}

export function setFontFamily(id: FontId) {
  setScopedItem(FONT_FAMILY_KEY, id);
  applyFontFamily(id);
}

export const FONT_SCALE_MIN = 85;
export const FONT_SCALE_MAX = 130;
export const FONT_SCALE_DEFAULT = 100;

export function getFontScale(): number {
  const raw = Number(getScopedItem(FONT_SCALE_KEY));
  if (!raw || Number.isNaN(raw)) return FONT_SCALE_DEFAULT;
  return Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, raw));
}

export function applyFontScale(pct: number) {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty("--app-font-scale", `${pct}%`);
}

export function setFontScale(pct: number) {
  const clamped = Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, Math.round(pct)));
  setScopedItem(FONT_SCALE_KEY, String(clamped));
  applyFontScale(clamped);
}

export function getReduceMotion(): boolean {
  return getScopedItem(REDUCE_MOTION_KEY) === "true";
}

export function applyReduceMotion(on: boolean) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-reduce-motion", on ? "true" : "false");
}

export function setReduceMotion(on: boolean) {
  setScopedItem(REDUCE_MOTION_KEY, String(on));
  applyReduceMotion(on);
}

/** Apply persisted prefs to the document. Call once on app mount. */
export function applyStoredSettings() {
  applyFontScale(getFontScale());
  applyReduceMotion(getReduceMotion());
  applyFontFamily(getFontFamily());
  applyPalette(getPalette());
}
