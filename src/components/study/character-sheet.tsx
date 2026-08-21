"use client";

import { useMemo } from "react";
import type { GameState } from "@/lib/gamify/state";
import { computeStats, archetype, STAT_MAX, type Stat } from "@/lib/gamify/stats";

/**
 * The character sheet: who you are, rather than how much you have done.
 *
 * The dashboard beside it already answers "how much" — XP, levels, tiers. This
 * answers the question that keeps mattering after those numbers stop being
 * surprising: a stat block derived from how you actually study, and a title
 * that names the habit rather than the total.
 */
export function CharacterSheet({ game }: { game: GameState }) {
  const stats = useMemo(
    () => computeStats(game.counters, game.player.streakDays),
    [game.counters, game.player.streakDays],
  );
  const title = useMemo(() => archetype(stats, game.player.level), [stats, game.player.level]);

  const p = game.player;
  const unlocked = game.achievements.filter((a) => a.unlocked);

  return (
    <section className="rounded-xl border border-border bg-card">
      <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Character
        </h2>
      </header>

      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-start">
        <div className="shrink-0 text-center sm:w-32">
          <div className="text-sm font-semibold">{title}</div>
          <div className="text-[11px]" style={{ color: p.rankColor }}>
            {p.rank} · Lv {p.level}
          </div>
        </div>

        <div className="min-w-0 flex-1 space-y-3">
          <StatBlock stats={stats} accent={p.rankColor} />

          <dl className="grid grid-cols-3 gap-2 text-center text-[11px] text-muted-foreground">
            <Figure label="Streak" value={`${p.streakDays}d`} />
            <Figure label="Today" value={`${p.dailyXp}/${p.dailyGoal}`} />
            <Figure label="Relics" value={`${unlocked.length}/${game.achievements.length}`} />
          </dl>
        </div>
      </div>
    </section>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-border px-2 py-1.5">
      <dt className="uppercase tracking-wider">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold text-foreground">{value}</dd>
    </div>
  );
}

function StatBlock({ stats, accent }: { stats: Stat[]; accent: string }) {
  return (
    <ul className="space-y-1.5">
      {stats.map((s) => (
        <li key={s.key} className="flex items-center gap-2" title={`${s.name} — ${s.hint}`}>
          <span className="w-9 shrink-0 text-[11px] font-semibold uppercase text-muted-foreground">
            {s.key}
          </span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full transition-[width] duration-500"
              style={{ width: `${(s.value / STAT_MAX) * 100}%`, background: accent }}
            />
          </div>
          <span className="w-6 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
            {s.value}
          </span>
        </li>
      ))}
    </ul>
  );
}
