"use client";

import { Flame, Target, Trophy, Lock, ChevronRight, Sparkles } from "lucide-react";
import { cn, formatRelativeTime } from "@/lib/utils";
import type { GameState, GameSkill, GamePlayer } from "@/lib/gamify/state";
import { RANKS, TIERS } from "@/lib/gamify/levels";

/** Self-contained keyframes — the HUD's shine/pulse/aura, no global CSS. */
const HUD_CSS = `
@keyframes sb-shine { 0% { transform: translateX(-120%); } 60%, 100% { transform: translateX(320%); } }
@keyframes sb-aura { 0%, 100% { opacity: 0.45; transform: scale(1); } 50% { opacity: 0.9; transform: scale(1.06); } }
@keyframes sb-pop { 0% { transform: scale(0.8); opacity: 0; } 60% { transform: scale(1.06); } 100% { transform: scale(1); opacity: 1; } }
@media (prefers-reduced-motion: reduce) {
  .sb-shine, .sb-aura, .sb-pop { animation: none !important; }
}
`;

const pct = (n: number, d: number) => (d > 0 ? Math.min(100, Math.round((n / d) * 100)) : 0);

/** The gamified HUD shown at the top of Study → Overview. */
export function GamifyDashboard({ game }: { game: GameState }) {
  const { player, skills, achievements, recent } = game;

  // Group skills by domain so a future "fitness" domain renders its own section.
  const byDomain = new Map<string, GameSkill[]>();
  for (const s of skills) (byDomain.get(s.domain) ?? byDomain.set(s.domain, []).get(s.domain)!).push(s);
  const domains = [...byDomain.keys()];

  const unlocked = achievements.filter((a) => a.unlocked);
  const locked = achievements.filter((a) => !a.unlocked);

  return (
    <div className="space-y-6">
      <style>{HUD_CSS}</style>

      <PlayerHero player={player} />
      <RankLadder level={player.level} />

      {/* Skills */}
      <div>
        <div className="editorial-section-row mb-3">
          <span className="editorial-eyebrow-brand">§ Skills</span>
          <span className="editorial-section-rule" />
          <span className="text-[11px] italic text-muted-foreground">
            {skills.length > 0 ? `${skills.length} growing` : "none yet"}
          </span>
        </div>
        {skills.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
            No skills yet. Complete tasks, review cards, read, or distill items — skills grow automatically,
            and each one climbs its own tier ladder from Common to Celestial.
          </p>
        ) : (
          domains.map((domain) => (
            <div key={domain} className="mb-3">
              {domains.length > 1 && (
                <div className="mb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground/70">{domain}</div>
              )}
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {byDomain.get(domain)!.map((s) => (
                  <SkillCard key={s.id} skill={s} />
                ))}
              </div>
            </div>
          ))
        )}
        {skills.length > 0 && <TierLadder skills={skills} />}
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
                className="sb-pop flex items-center gap-1.5 rounded-full border border-amber-500/40 px-2.5 py-1 text-xs"
                style={{
                  background: "linear-gradient(135deg, rgba(245,158,11,0.18), rgba(236,72,153,0.10))",
                  animation: "sb-pop 320ms ease-out both",
                }}
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
                <span
                  className={cn(
                    "w-12 shrink-0 font-semibold tabular-nums",
                    r.amount >= 40
                      ? "text-amber-600 dark:text-amber-400"
                      : "text-emerald-600 dark:text-emerald-400",
                  )}
                >
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

/** Rank medallion + XP bar + streak/goal, all themed to the current rank. */
function PlayerHero({ player }: { player: GamePlayer }) {
  const grad = `linear-gradient(135deg, ${player.rankFrom}, ${player.rankTo})`;
  const goalPct = pct(player.dailyXp, player.dailyGoal);
  const goalHit = player.dailyXp >= player.dailyGoal;

  return (
    <div
      className="relative overflow-hidden rounded-2xl border p-5"
      style={{
        borderColor: `${player.rankColor}59`,
        background: `linear-gradient(135deg, ${player.rankFrom}1f, transparent 60%)`,
      }}
    >
      <div className="flex items-center gap-4">
        {/* Medallion: gradient ring, with a soft aura once the rank glows. */}
        <div className="relative h-16 w-16 shrink-0">
          {player.rankGlow && (
            <span
              className="sb-aura absolute -inset-1.5 rounded-full blur-md"
              style={{ background: grad, animation: "sb-aura 2.8s ease-in-out infinite" }}
              aria-hidden
            />
          )}
          <div className="relative flex h-16 w-16 items-center justify-center rounded-full p-[2.5px]" style={{ background: grad }}>
            <div className="flex h-full w-full flex-col items-center justify-center rounded-full bg-background">
              <span className="text-[9px] uppercase tracking-wider text-muted-foreground">Lv</span>
              <span className="text-2xl font-bold leading-none tabular-nums">{player.level}</span>
            </div>
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-lg font-semibold" style={{ color: player.rankColor }}>
              {player.rank}
            </span>
            <span className="text-xs text-muted-foreground tabular-nums">
              {player.totalXp.toLocaleString()} XP total
            </span>
            {player.nextRank && player.levelsToNextRank !== null && (
              <span className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground">
                {player.levelsToNextRank} {player.levelsToNextRank === 1 ? "level" : "levels"}
                <ChevronRight className="h-3 w-3" />
                <span className="font-medium" style={{ color: player.rankColor }}>{player.nextRank}</span>
              </span>
            )}
          </div>

          {/* XP bar — rank gradient with a travelling highlight. */}
          <div className="relative mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="relative h-full overflow-hidden rounded-full transition-all duration-500"
              style={{ width: `${pct(player.intoLevel, player.span)}%`, background: grad }}
            >
              <span
                className="sb-shine absolute inset-y-0 w-1/3 bg-white/40"
                style={{ animation: "sb-shine 2.6s ease-in-out infinite" }}
                aria-hidden
              />
            </div>
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground tabular-nums">
            {player.intoLevel}/{player.span} to level {player.level + 1}
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-3">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Flame className={cn("h-4 w-4", player.streakDays > 0 ? "text-orange-500" : "text-muted-foreground")} />
            Streak
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-xl font-semibold tabular-nums">{player.streakDays}d</span>
            {player.streakBonusPct > 0 && (
              <span className="rounded-md bg-orange-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-orange-600 tabular-nums dark:text-orange-400">
                +{player.streakBonusPct}% XP
              </span>
            )}
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            {player.streakBonusPct >= 60 ? "Bonus maxed — keep it alive." : "Every day adds +6%, up to +60%."}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-3">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Target className="h-4 w-4" style={{ color: goalHit ? "#10b981" : player.rankColor }} /> Daily goal
            </span>
            {goalHit && (
              <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                <Sparkles className="h-3 w-3" /> +50 bonus
              </span>
            )}
          </div>
          <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${goalPct}%`,
                background: goalHit ? "linear-gradient(90deg, #34d399, #10b981)" : grad,
              }}
            />
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground tabular-nums">
            {player.dailyXp}/{player.dailyGoal} XP today
          </div>
        </div>
      </div>
    </div>
  );
}

/** The rank track — every milestone, lit up to where you are. */
function RankLadder({ level }: { level: number }) {
  // Window the ladder so it stays readable: a couple behind, the rest ahead.
  const currentIdx = Math.max(0, RANKS.findIndex((r, i) => level >= r.minLevel && (i === RANKS.length - 1 || level < RANKS[i + 1].minLevel)));
  const start = Math.max(0, Math.min(currentIdx - 1, RANKS.length - 5));
  const window = RANKS.slice(start, start + 5);

  return (
    <div className="rounded-xl border border-border bg-card/50 p-3">
      <div className="mb-2.5 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Rank track</span>
        <span className="text-[10px] text-muted-foreground/70 tabular-nums">
          {currentIdx + 1} of {RANKS.length}
        </span>
      </div>
      <div className="flex items-start gap-1">
        {window.map((r) => {
          const idx = RANKS.indexOf(r);
          const reached = level >= r.minLevel;
          const current = idx === currentIdx;
          return (
            <div key={r.title} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
              <div className="relative flex h-2 w-full items-center">
                <span className="absolute inset-x-0 h-[3px] rounded-full bg-muted" />
                <span
                  className="absolute inset-y-0 left-0 h-[3px] self-center rounded-full transition-all"
                  style={{
                    width: reached ? "100%" : "0%",
                    background: `linear-gradient(90deg, ${r.from}, ${r.to})`,
                  }}
                />
              </div>
              <span
                className={cn(
                  "h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-background transition-all",
                  current && "h-3.5 w-3.5",
                )}
                style={{
                  background: reached ? `linear-gradient(135deg, ${r.from}, ${r.to})` : "hsl(var(--muted))",
                  boxShadow: current ? `0 0 0 3px ${r.color}33` : undefined,
                }}
              />
              <span
                className={cn(
                  "w-full truncate text-center text-[10px]",
                  current ? "font-semibold" : "text-muted-foreground/70",
                )}
                style={{ color: current ? r.color : undefined }}
                title={`${r.title} · level ${r.minLevel}+`}
              >
                {r.title}
              </span>
              <span className="text-[9px] tabular-nums text-muted-foreground/50">Lv{r.minLevel}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Which tiers you've unlocked across all skills — the collection view. */
function TierLadder({ skills }: { skills: GameSkill[] }) {
  const best = skills.reduce((m, s) => Math.max(m, s.level), 0);
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Tiers</span>
      {TIERS.map((t) => {
        const reached = best >= t.minLevel;
        return (
          <span
            key={t.name}
            title={`${t.name} · ${t.rarity} · level ${t.minLevel}+`}
            className={cn(
              "rounded-full border px-2 py-0.5 text-[10px] font-medium transition-all",
              !reached && "border-border text-muted-foreground/40",
            )}
            style={
              reached
                ? {
                    borderColor: `${t.color}66`,
                    background: `linear-gradient(135deg, ${t.from}33, ${t.to}22)`,
                    color: t.color,
                    boxShadow: t.glow ? `0 0 10px ${t.color}44` : undefined,
                  }
                : undefined
            }
          >
            {t.rarity}
          </span>
        );
      })}
    </div>
  );
}

function SkillCard({ skill }: { skill: GameSkill }) {
  const grad = `linear-gradient(135deg, ${skill.from}, ${skill.to})`;
  const progress = pct(skill.intoLevel, skill.span);

  return (
    <div
      className="relative overflow-hidden rounded-xl border bg-card p-3 transition-shadow"
      style={{
        borderColor: `${skill.color}66`,
        background: `linear-gradient(135deg, ${skill.from}14, transparent 55%)`,
        boxShadow: skill.glow ? `0 0 0 1px ${skill.color}33, 0 0 18px -6px ${skill.color}aa` : `inset 0 0 0 1px ${skill.color}1f`,
      }}
    >
      <div className="flex items-center gap-2">
        <span className="text-lg">{skill.emoji ?? "📘"}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{skill.name}</div>
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider" style={{ color: skill.color }}>
            <span>{skill.tier}</span>
            <span
              className="rounded-full px-1.5 py-px text-[9px] font-semibold tracking-normal"
              style={{
                background: `${skill.color}24`,
                boxShadow: skill.glow ? `0 0 8px ${skill.color}66` : undefined,
              }}
            >
              {skill.rarity}
            </span>
          </div>
        </div>
        <span
          className="shrink-0 rounded-md px-2 py-1 text-xs font-bold tabular-nums text-white"
          style={{ background: grad, boxShadow: skill.glow ? `0 0 12px -2px ${skill.color}` : undefined }}
        >
          Lv {skill.level}
        </span>
      </div>

      <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${progress}%`, background: grad }} />
      </div>

      <div className="mt-1.5 flex items-center justify-between text-[10px] text-muted-foreground">
        <span className="tabular-nums">
          {skill.intoLevel}/{skill.span} XP
        </span>
        {skill.nextTier && skill.levelsToNextTier !== null ? (
          <span className="flex items-center gap-1">
            {skill.levelsToNextTier} {skill.levelsToNextTier === 1 ? "level" : "levels"}
            <ChevronRight className="h-3 w-3" />
            <span style={{ color: skill.nextTierColor ?? undefined }}>{skill.nextTier}</span>
          </span>
        ) : (
          <span style={{ color: skill.color }}>Max tier</span>
        )}
      </div>
    </div>
  );
}
