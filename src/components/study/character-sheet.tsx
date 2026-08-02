"use client";

import { useMemo } from "react";
import { Monitor, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { GameState } from "@/lib/gamify/state";
import { computeStats, archetype, STAT_MAX, type Stat } from "@/lib/gamify/stats";
import { proceduralSigil } from "@/lib/gamify/sigil";
import { SigilAvatar } from "./sigil-avatar";
import { usePixelMode } from "./use-pixel-mode";

/**
 * The character sheet: who you are, rather than how much you have done.
 *
 * The dashboard beside it already answers "how much" — XP, levels, tiers. This
 * answers the question that keeps mattering after those numbers stop being
 * surprising: a sigil that is permanently yours, a stat block derived from how
 * you actually study, and a title that names the habit rather than the total.
 *
 * ## Two skins, one set of facts
 *
 * `pixel` switches the presentation and nothing else. Both renderings read the
 * same `GameState` and show the same five stats, the same level, the same
 * title — so the toggle can never hide progress, and the plain skin stays a
 * complete view rather than a degraded one. That is what makes it honest to
 * default to plain and let the console be a choice.
 */
export function CharacterSheet({
  game,
  seed,
  initialPixel = false,
}: {
  game: GameState;
  /** Stable per-user string — the sigil's shape is derived from it and must
   *  never change, or the character stops being recognisably the same one. */
  seed: string;
  initialPixel?: boolean;
}) {
  const [pixel, togglePixel] = usePixelMode(initialPixel);

  const stats = useMemo(
    () => computeStats(game.counters, game.player.streakDays),
    [game.counters, game.player.streakDays],
  );
  const title = useMemo(() => archetype(stats, game.player.level), [stats, game.player.level]);
  const sigil = useMemo(() => proceduralSigil(seed), [seed]);

  const p = game.player;
  const unlocked = game.achievements.filter((a) => a.unlocked);

  return (
    <section
      className={cn(
        "rounded-xl border",
        pixel
          ? // The console commits to its own dark palette rather than following
            // the app theme: a pixel surface that switches to light looks like a
            // rendering fault, and fighting both themes doubles the work for no
            // gain. Square corners because rounded ones read as anti-aliased.
            "border-[#3a4466] bg-[#0f0f1b] text-[#c0cbdc] [border-radius:0]"
          : "border-border bg-card",
      )}
    >
      <header
        className={cn(
          "flex items-center justify-between gap-2 border-b px-4 py-2",
          pixel ? "border-[#3a4466]" : "border-border",
        )}
      >
        <h2
          className={cn(
            "text-xs font-semibold uppercase tracking-wider",
            pixel ? "tracking-[0.2em] text-[#8b9bb4]" : "text-muted-foreground",
          )}
        >
          {pixel ? "◆ Character" : "Character"}
        </h2>
        <button
          onClick={togglePixel}
          aria-pressed={pixel}
          className={cn(
            "flex items-center gap-1.5 px-2 py-1 text-[11px] transition-colors",
            pixel
              ? "border border-[#3a4466] text-[#8b9bb4] hover:text-[#c0cbdc]"
              : "rounded border border-border text-muted-foreground hover:text-foreground",
          )}
        >
          {pixel ? <Monitor className="h-3 w-3" /> : <Sparkles className="h-3 w-3" />}
          {pixel ? "Normal view" : "Pixel view"}
        </button>
      </header>

      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-start">
        <div className="flex shrink-0 flex-col items-center gap-2">
          <div
            className={cn(
              "flex items-center justify-center p-2",
              pixel ? "border-2 border-[#3a4466] bg-[#181425]" : "rounded-lg border border-border bg-muted/40",
            )}
          >
            <SigilAvatar
              source={sigil}
              body={p.rankFrom}
              accent={p.rankTo}
              glow={p.rankGlow}
              size={88}
              label={`${title}, level ${p.level}`}
            />
          </div>
          <div className="text-center">
            <div className={cn("text-sm font-semibold", pixel && "tracking-wide")}>{title}</div>
            <div
              className={cn("text-[11px]", pixel ? "text-[#8b9bb4]" : "text-muted-foreground")}
              style={pixel ? undefined : { color: p.rankColor }}
            >
              {p.rank} · Lv {p.level}
            </div>
          </div>
        </div>

        <div className="min-w-0 flex-1 space-y-3">
          <StatBlock stats={stats} pixel={pixel} accent={p.rankColor} />

          <dl
            className={cn(
              "grid grid-cols-3 gap-2 text-center text-[11px]",
              pixel ? "text-[#8b9bb4]" : "text-muted-foreground",
            )}
          >
            <Figure label="Streak" value={`${p.streakDays}d`} pixel={pixel} />
            <Figure label="Today" value={`${p.dailyXp}/${p.dailyGoal}`} pixel={pixel} />
            <Figure label="Relics" value={`${unlocked.length}/${game.achievements.length}`} pixel={pixel} />
          </dl>
        </div>
      </div>
    </section>
  );
}

function Figure({ label, value, pixel }: { label: string; value: string; pixel: boolean }) {
  return (
    <div
      className={cn(
        "px-2 py-1.5",
        pixel ? "border border-[#3a4466] bg-[#181425]" : "rounded border border-border",
      )}
    >
      <dt className="uppercase tracking-wider">{label}</dt>
      <dd className={cn("mt-0.5 text-sm font-semibold", pixel ? "text-[#c0cbdc]" : "text-foreground")}>
        {value}
      </dd>
    </div>
  );
}

function StatBlock({ stats, pixel, accent }: { stats: Stat[]; pixel: boolean; accent: string }) {
  return (
    <ul className="space-y-1.5">
      {stats.map((s) => (
        <li key={s.key} className="flex items-center gap-2" title={`${s.name} — ${s.hint}`}>
          <span
            className={cn(
              "w-9 shrink-0 text-[11px] font-semibold uppercase",
              pixel ? "tracking-[0.15em] text-[#8b9bb4]" : "text-muted-foreground",
            )}
          >
            {s.key}
          </span>
          {pixel ? (
            // Segmented, so the bar reads as discrete pixels rather than a
            // smooth fill — a continuous gradient in a pixel skin is the
            // giveaway that it is a web page wearing a costume.
            <PixelBar value={s.value} accent={accent} />
          ) : (
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full transition-[width] duration-500"
                style={{ width: `${(s.value / STAT_MAX) * 100}%`, background: accent }}
              />
            </div>
          )}
          <span
            className={cn(
              "w-6 shrink-0 text-right text-[11px] tabular-nums",
              pixel ? "text-[#c0cbdc]" : "text-muted-foreground",
            )}
          >
            {s.value}
          </span>
        </li>
      ))}
    </ul>
  );
}

const SEGMENTS = 20;

function PixelBar({ value, accent }: { value: number; accent: string }) {
  const lit = Math.round((value / STAT_MAX) * SEGMENTS);
  return (
    <div className="flex flex-1 gap-[2px]">
      {Array.from({ length: SEGMENTS }).map((_, i) => (
        <span
          key={i}
          className="h-2.5 flex-1"
          style={{ background: i < lit ? accent : "#3a4466" }}
        />
      ))}
    </div>
  );
}
