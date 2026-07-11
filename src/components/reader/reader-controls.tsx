"use client";

import { useEffect, useState } from "react";
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

export function ReaderControls() {
  const prefs = useReaderPrefs();
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <Button
        size="icon"
        variant="ghost"
        title="Reader settings"
        onClick={() => setOpen((v) => !v)}
      >
        <Type className="h-4 w-4" />
      </Button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-64 rounded-md border border-border bg-popover p-3 text-sm shadow-md">
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
        </>
      )}
    </div>
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
