"use client";

import { Flame, Target, Trophy, Lock } from "lucide-react";
import { cn, formatRelativeTime } from "@/lib/utils";
import type { GameState, GameSkill } from "@/lib/gamify/state";

/** The gamified HUD shown at the top of Study → Overview. */
export function GamifyDashboard({ game }: { game: GameState }) {
  const { player, skills, achievements, recent } = game;
  const pct = (n: number, d: number) => (d > 0 ? Math.min(100, Math.round((n / d) * 100)) : 0);

  // Group skills by domain so a future "fitness" domain renders its own section.
  const byDomain = new Map<string, GameSkill[]>();
  for (const s of skills) (byDomain.get(s.domain) ?? byDomain.set(s.domain, []).get(s.domain)!).push(s);
  const domains = [...byDomain.keys()];

  const unlocked = achievements.filter((a) => a.unlocked);
  const locked = achievements.filter((a) => !a.unlocked);

  return (
    <div className="space-y-6">
      {/* Player header */}
      <div className="rounded-2xl border border-border bg-gradient-to-br from-primary/[0.07] to-transparent p-5">
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-full border-2 border-primary/40 bg-background">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Lv</span>
            <span className="text-2xl font-bold leading-none tabular-nums">{player.level}</span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className="text-lg font-semibold">{player.rank}</span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {player.totalXp.toLocaleString()} XP total
              </span>
            </div>
            <div className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct(player.intoLevel, player.span)}%` }} />
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground tabular-nums">
              {player.intoLevel}/{player.span} to level {player.level + 1}
            </div>
          </div>
        </div>
        <div className="mt-4 flex gap-3">
          <Stat icon={<Flame className="h-4 w-4 text-orange-500" />} label="Streak" value={`${player.streakDays}d`} />
          <div className="flex-1 rounded-xl border border-border bg-card p-3">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Target className="h-4 w-4 text-primary" /> Daily goal
            </div>
            <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={cn("h-full rounded-full transition-all", player.dailyXp >= player.dailyGoal ? "bg-emerald-500" : "bg-primary")}
                style={{ width: `${pct(player.dailyXp, player.dailyGoal)}%` }}
              />
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground tabular-nums">
              {player.dailyXp}/{player.dailyGoal} XP today
            </div>
          </div>
        </div>
      </div>

      {/* Skills */}
      <div>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Skills</h2>
        {skills.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
            No skills yet. Complete tasks, review cards, read, or distill items — skills grow automatically.
          </p>
        ) : (
          domains.map((domain) => (
            <div key={domain} className="mb-3">
              {domains.length > 1 && (
                <div className="mb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground/70">{domain}</div>
              )}
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {byDomain.get(domain)!.map((s) => (
                  <SkillCard key={s.id} skill={s} pct={pct(s.intoLevel, s.span)} />
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Achievements */}
      {achievements.length > 0 && (
        <div>
          <h2 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <Trophy className="h-3.5 w-3.5" /> Achievements
            <span className="font-normal normal-case text-muted-foreground/70">
              {unlocked.length}/{achievements.length}
            </span>
          </h2>
          <div className="flex flex-wrap gap-2">
            {unlocked.map((a) => (
              <div
                key={a.key}
                title={a.desc}
                className="flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs"
              >
                <span>{a.emoji}</span>
                <span className="font-medium">{a.name}</span>
              </div>
            ))}
            {locked.slice(0, 6).map((a) => (
              <div
                key={a.key}
                title={a.desc}
                className="flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-xs text-muted-foreground/60"
              >
                <Lock className="h-3 w-3" />
                <span>{a.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent XP feed */}
      {recent.length > 0 && (
        <div>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Recent XP</h2>
          <ul className="space-y-1">
            {recent.map((r) => (
              <li key={r.id} className="flex items-center gap-2 text-sm">
                <span className="w-12 shrink-0 font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                  +{r.amount}
                </span>
                <span className="min-w-0 flex-1 truncate text-foreground/90">
                  {r.label}
                  {r.skill && <span className="text-muted-foreground"> · {r.skill}</span>}
                </span>
                <span className="shrink-0 text-[11px] text-muted-foreground">{formatRelativeTime(r.at)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">{icon} {label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function SkillCard({ skill, pct }: { skill: GameSkill; pct: number }) {
  return (
    <div
      className="rounded-xl border bg-card p-3"
      style={{ borderColor: `${skill.color}66`, boxShadow: `inset 0 0 0 1px ${skill.color}22` }}
    >
      <div className="flex items-center gap-2">
        <span className="text-lg">{skill.emoji ?? "📘"}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{skill.name}</div>
          <div className="text-[10px] uppercase tracking-wider" style={{ color: skill.color }}>
            {skill.tier} · {skill.rarity}
          </div>
        </div>
        <span className="shrink-0 rounded-md px-1.5 py-0.5 text-xs font-bold tabular-nums" style={{ background: `${skill.color}22`, color: skill.color }}>
          Lv {skill.level}
        </span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: skill.color }} />
      </div>
    </div>
  );
}
