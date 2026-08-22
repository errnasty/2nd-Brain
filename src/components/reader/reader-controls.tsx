"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Minus, Plus, Type } from "lucide-react";
import { Button } from "@/components/ui/button";

export type ReaderTheme = "default" | "sepia";
export type ReaderFont = "Times New Roman" | "Georgia" | "Inter" | "system-ui";
export type ReaderPrefs = {
  font: ReaderFont;
  fontSize: number;
  theme: ReaderTheme;
};

const KEY = "reader.prefs.v1";
const DEFAULTS: ReaderPrefs = { font: "Times New Roman", fontSize: 18, theme: "default" };
const FONT_OPTIONS: ReaderFont[] = ["Times New Roman", "Georgia", "Inter", "system-ui"];

function readStored(): ReaderPrefs {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return DEFAULTS;
  }
}

let listeners: Array<(p: ReaderPrefs) => void> = [];
let current = DEFAULTS;
let hydrated = false;

function setPrefs(patch: Partial<ReaderPrefs>) {
  current = { ...current, ...patch };
  if (typeof window !== "undefined") {
    window.localStorage.setItem(KEY, JSON.stringify(current));
  }
  listeners.forEach((fn) => fn(current));
}

export function useReaderPrefs(): ReaderPrefs {
  const [prefs, set] = useState<ReaderPrefs>(current);

  useEffect(() => {
    if (!hydrated) {
      current = readStored();
      hydrated = true;
      set(current);
    }
    listeners.push(set);
    return () => {
      listeners = listeners.filter((l) => l !== set);
    };
  }, []);

  return prefs;
}

/** Panel width in px. Needed as a number to clamp the panel into the viewport. */
const PANEL_WIDTH = 256;

export function ReaderControls() {
  const prefs = useReaderPrefs();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  /**
   * Position the panel against the trigger's viewport rect.
   *
   * The panel is rendered into document.body rather than next to the button
   * because the article reader's toolbar is `overflow-hidden max-h-20` (it
   * collapses on scroll on mobile). An absolutely-positioned child of that row
   * is clipped to a 20-unit-tall strip — which is why this button looked dead
   * on a phone: the panel opened every time, into a box that could not show it.
   * The sibling menus never hit this because Radix portals them out.
   */
  const place = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const margin = 8;
    // Right-align to the trigger, then clamp so a trigger near either edge of a
    // narrow screen still yields a fully visible panel.
    const left = Math.max(
      margin,
      Math.min(r.right - PANEL_WIDTH, window.innerWidth - PANEL_WIDTH - margin),
    );
    setPos({ top: r.bottom + 4, left });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    place();
    window.addEventListener("resize", place);
    // Capture phase: the reader scrolls in a nested container, so a bubbling
    // window listener would never see it and the panel would drift off-anchor.
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <Button
        ref={triggerRef}
        size="icon"
        variant="ghost"
        title="Reader settings"
        aria-label="Reader settings"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={open ? "text-primary" : undefined}
      >
        <Type className="h-4 w-4" />
      </Button>
      {open &&
        pos &&
        typeof document !== "undefined" &&
        createPortal(
          <>
            <div className="fixed inset-0 z-50" onClick={() => setOpen(false)} />
            <div
              role="dialog"
              aria-label="Reader settings"
              className="fixed z-50 w-64 rounded-md border border-border bg-popover p-3 text-sm shadow-md"
              style={{ top: pos.top, left: pos.left }}
            >
              <div className="mb-3">
                <div className="mb-1 text-xs font-medium text-muted-foreground">Font</div>
                <select
                  className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
                  value={prefs.font}
                  onChange={(e) => setPrefs({ font: e.target.value as ReaderFont })}
                >
                  {FONT_OPTIONS.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </div>
              <div className="mb-3">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">Size</span>
                  <span className="text-xs tabular-nums text-muted-foreground">{prefs.fontSize}px</span>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="icon"
                    variant="outline"
                    className="h-7 w-7"
                    onClick={() => setPrefs({ fontSize: Math.max(12, prefs.fontSize - 1) })}
                    title="Smaller text"
                  >
                    <Minus className="h-3 w-3" />
                  </Button>
                  <input
                    type="range"
                    min={12}
                    max={28}
                    value={prefs.fontSize}
                    onChange={(e) => setPrefs({ fontSize: Number(e.target.value) })}
                    className="flex-1 accent-foreground"
                  />
                  <Button
                    size="icon"
                    variant="outline"
                    className="h-7 w-7"
                    onClick={() => setPrefs({ fontSize: Math.min(28, prefs.fontSize + 1) })}
                    title="Larger text"
                  >
                    <Plus className="h-3 w-3" />
                  </Button>
                </div>
              </div>
              <div>
                <div className="mb-1 text-xs font-medium text-muted-foreground">Theme</div>
                <div className="grid grid-cols-2 gap-2">
                  <ThemeChip label="Default" active={prefs.theme === "default"} onClick={() => setPrefs({ theme: "default" })} />
                  <ThemeChip label="Sepia" active={prefs.theme === "sepia"} onClick={() => setPrefs({ theme: "sepia" })} />
                </div>
              </div>
            </div>
          </>,
          document.body,
        )}
    </>
  );
}

function ThemeChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md border px-2 py-1 text-xs ${
        active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-accent"
      }`}
    >
      {label}
    </button>
  );
}
