"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Check, ChevronDown, Minus, Monitor, Moon, Plus, RotateCcw, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { CHAT_MODELS, DEFAULT_CHAT_MODEL } from "@/lib/ai/models";
import {
  ASK_MODEL_KEY,
  FONT_FAMILY_DEFAULT,
  FONT_OPTIONS,
  FONT_SCALE_DEFAULT,
  FONT_SCALE_MAX,
  FONT_SCALE_MIN,
  PALETTE_DEFAULT,
  PALETTE_OPTIONS,
  getFontFamily,
  getFontScale,
  getPalette,
  getReduceMotion,
  getScopedItem,
  setScopedItem,
  setFontFamily,
  setFontScale,
  setPalette,
  setReduceMotion,
  type FontId,
  type PaletteId,
} from "@/lib/settings";
import { toast } from "sonner";
import { updateUserSettingsAction } from "@/lib/settings/actions";


// Representative swatch per palette (the CSS vars are scoped to :root/.dark, so
// a swatch can't read them here — these mirror each palette's --brand accent).
const PALETTE_SWATCH: Record<PaletteId, string> = {
  parchment: "hsl(30 72% 45%)",
  mono: "linear-gradient(135deg, #f4f4f4 0 50%, #111 50% 100%)",
  ocean: "hsl(214 90% 48%)",
  forest: "hsl(148 55% 38%)",
  "soft-beach": "hsl(175 55% 40%)",
  purple90s: "hsl(275 70% 50%)",
  "bright-power": "hsl(8 85% 52%)",
};

export function Row({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-4">
      <div className="min-w-0">
        <div className="text-sm font-medium">{title}</div>
        {desc && <div className="mt-0.5 text-xs text-muted-foreground">{desc}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function SettingsForm({ serverAiModel = null }: { serverAiModel?: string | null }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [fontScale, setFontScaleState] = useState(FONT_SCALE_DEFAULT);
  const [fontFamily, setFontFamilyState] = useState<FontId>(FONT_FAMILY_DEFAULT);
  const [palette, setPaletteState] = useState<PaletteId>(PALETTE_DEFAULT);
  const [reduceMotion, setReduceMotionState] = useState(false);
  const [model, setModel] = useState(DEFAULT_CHAT_MODEL);

  useEffect(() => {
    setMounted(true);
    setFontScaleState(getFontScale());
    setFontFamilyState(getFontFamily());
    setPaletteState(getPalette());
    setReduceMotionState(getReduceMotion());
    // Model: the server copy (cross-device, drives background AI) wins; a
    // legacy local-only pick is backfilled server-side so decks/quizzes/etc.
    // honor it too.
    const local = getScopedItem(ASK_MODEL_KEY);
    if (serverAiModel && CHAT_MODELS.some((x) => x.id === serverAiModel)) {
      setModel(serverAiModel);
      if (local !== serverAiModel) setScopedItem(ASK_MODEL_KEY, serverAiModel);
    } else if (local && CHAT_MODELS.some((x) => x.id === local)) {
      setModel(local);
      void updateUserSettingsAction({ aiModel: local }).catch(() => {});
    }
  }, [serverAiModel]);

  function bumpFont(delta: number) {
    const next = Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, fontScale + delta));
    setFontScaleState(next);
    setFontScale(next);
  }

  function chooseFont(id: FontId) {
    setFontFamilyState(id);
    setFontFamily(id);
  }

  function choosePalette(id: PaletteId) {
    setPaletteState(id);
    setPalette(id);
  }

  function chooseModel(id: string) {
    setModel(id);
    // Instant client reads (Ask / reader / rabbithole pass the model per
    // request) + the server copy that background AI (decks, quizzes,
    // flashcards, tagging…) resolves against. Fire-and-forget: the local
    // pick must never block on the network.
    setScopedItem(ASK_MODEL_KEY, id);
    void updateUserSettingsAction({ aiModel: id }).catch(() => {});
  }

  function resetAll() {
    setTheme("dark");
    setFontScaleState(FONT_SCALE_DEFAULT);
    setFontScale(FONT_SCALE_DEFAULT);
    chooseFont(FONT_FAMILY_DEFAULT);
    choosePalette(PALETTE_DEFAULT);
    setReduceMotionState(false);
    setReduceMotion(false);
    chooseModel(DEFAULT_CHAT_MODEL);
    toast.success("Settings reset to defaults");
  }

  // Avoid hydration mismatch on theme/localStorage-derived values.
  if (!mounted) return <div className="h-64" />;

  const themes = [
    { id: "light", label: "Light", icon: Sun },
    { id: "dark", label: "Dark", icon: Moon },
    { id: "system", label: "System", icon: Monitor },
  ];

  return (
    <div className="divide-y divide-border">
      {/* Appearance */}
      <section>
        <h2 className="pb-1 pt-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Appearance
        </h2>

        <Row title="Theme" desc="Light, dark, or follow your system.">
          <div className="flex items-center gap-1 rounded-md border border-border p-0.5">
            {themes.map((t) => {
              const Icon = t.icon;
              const active = theme === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setTheme(t.id)}
                  className={cn(
                    "flex items-center gap-1.5 rounded px-2.5 py-1 text-xs transition-colors",
                    active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {t.label}
                </button>
              );
            })}
          </div>
        </Row>

        <Separator />

        <Row title="Colour theme" desc="Applies in both light and dark mode.">
          {/* A dropdown (not an inline button bar) so this scales past a
              handful of palettes without overflowing on mobile widths —
              matches the "Reading font" picker below. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" className="h-8 min-w-[9rem] justify-between gap-2">
                <span className="flex items-center gap-1.5">
                  <span
                    className="inline-block h-3 w-3 shrink-0 rounded-full border border-border"
                    style={{ background: PALETTE_SWATCH[palette] }}
                    aria-hidden
                  />
                  {PALETTE_OPTIONS.find((p) => p.id === palette)?.label}
                </span>
                <ChevronDown className="h-3.5 w-3.5 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {PALETTE_OPTIONS.map((p) => {
                const active = palette === p.id;
                return (
                  <DropdownMenuItem
                    key={p.id}
                    onClick={() => choosePalette(p.id)}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className="inline-block h-3 w-3 shrink-0 rounded-full border border-border"
                        style={{ background: PALETTE_SWATCH[p.id] }}
                        aria-hidden
                      />
                      {p.label}
                    </span>
                    {active && <Check className="h-3.5 w-3.5 shrink-0" />}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </Row>

        <Separator />

        <Row title="Font size" desc="Scales the whole app. Default 100%.">
          <div className="flex items-center gap-2">
            <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => bumpFont(-5)} disabled={fontScale <= FONT_SCALE_MIN} title="Decrease font size">
              <Minus className="h-3.5 w-3.5" />
            </Button>
            <span className="w-12 text-center text-sm tabular-nums">{fontScale}%</span>
            <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => bumpFont(5)} disabled={fontScale >= FONT_SCALE_MAX} title="Increase font size">
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
        </Row>

        <Separator />

        <Row title="Reading font" desc="Body typeface across the app.">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" className="h-8 min-w-[9rem] justify-between gap-2">
                <span style={{ fontFamily: FONT_OPTIONS.find((f) => f.id === fontFamily)?.stack }}>
                  {FONT_OPTIONS.find((f) => f.id === fontFamily)?.label}
                </span>
                <ChevronDown className="h-3.5 w-3.5 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {FONT_OPTIONS.map((f) => (
                <DropdownMenuItem
                  key={f.id}
                  onClick={() => chooseFont(f.id)}
                  className="flex items-center justify-between gap-2"
                >
                  <span className="flex flex-col" style={{ fontFamily: f.stack }}>
                    <span className="text-sm">{f.label}</span>
                    <span className="text-xs text-muted-foreground">Aa — the quick brown fox</span>
                  </span>
                  {fontFamily === f.id && <Check className="h-3.5 w-3.5 shrink-0" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </Row>

        <Separator />

        <Row title="Reduce motion" desc="Minimize animations and transitions.">
          <Checkbox
            checked={reduceMotion}
            onCheckedChange={(c) => {
              const on = c === true;
              setReduceMotionState(on);
              setReduceMotion(on);
            }}
          />
        </Row>
      </section>

      {/* AI */}
      <section className="pt-4">
        <h2 className="pb-1 pt-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          AI
        </h2>
        <Row
          title="Default AI model"
          desc="Used for Ask and every AI feature across the app — decks, quizzes, flashcards, summaries, tagging."
        >
          <div className="flex flex-col items-end gap-1">
            {CHAT_MODELS.map((m) => (
              <button
                key={m.id}
                onClick={() => chooseModel(m.id)}
                className={cn(
                  "flex items-center gap-1.5 rounded px-2 py-0.5 text-xs transition-colors",
                  model === m.id ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {model === m.id && <Check className="h-3 w-3" />}
                {m.label}
              </button>
            ))}
          </div>
        </Row>
      </section>

      {/* Reset */}
      <section className="pt-4">
        <Row title="Reset" desc="Restore all preferences above to defaults.">
          <Button size="sm" variant="outline" onClick={resetAll}>
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
            Reset
          </Button>
        </Row>
      </section>
    </div>
  );
}
