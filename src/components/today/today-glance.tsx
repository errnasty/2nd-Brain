"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Brain, CheckSquare, Flame, Lightbulb } from "lucide-react";
import type { TodayGlance as GlanceData } from "@/lib/today/glance";

type Chip = {
  key: string;
  icon: typeof Brain;
  label: string;
  sub: string;
  href: string;
  /** Higher = more urgent; drives ordering (evening pushes review to the top). */
  weight: number;
};

/**
 * "Today at a glance" — one compact, scannable strip of chips that consolidates
 * the daily-rhythm nudges (review, unlocked deck cards, tasks, streak) that
 * used to stack as separate full-width banners. Time-aware: after ~6pm it
 * reorders to a wind-down framing and leads with review.
 */
export function TodayGlance({ glance, firstDeckId }: { glance: GlanceData; firstDeckId: string | null }) {
  // Local hour, resolved after mount (server TZ ≠ user TZ). Until then, assume
  // daytime ordering — the reorder is a nicety, not correctness.
  const [hour, setHour] = useState(12);
  useEffect(() => {
    const update = () => setHour(new Date().getHours());
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  const evening = hour >= 18 || hour < 5;

  const chips: Chip[] = [];
  if (glance.streakDays > 0) {
    chips.push({
      key: "streak",
      icon: Flame,
      label: `${glance.streakDays}-day streak`,
      sub: glance.dailyXp >= glance.dailyGoal ? "goal hit" : `${glance.dailyXp}/${glance.dailyGoal} XP today`,
      href: "/study",
      weight: 1,
    });
  }
  if (glance.dueCards > 0) {
    chips.push({
      key: "review",
      icon: Brain,
      label: `${glance.dueCards} card${glance.dueCards === 1 ? "" : "s"} due`,
      sub: `~${glance.reviewMinutes} min`,
      href: "/study?tab=review",
      // Reviews are the day's decaying obligation — surface them hardest in
      // the evening when the streak is on the line.
      weight: evening ? 5 : 3,
    });
  }
  if (glance.deckCards > 0 && firstDeckId) {
    chips.push({
      key: "decks",
      icon: Lightbulb,
      label: `${glance.deckCards} idea card${glance.deckCards === 1 ? "" : "s"}`,
      sub: glance.dailyDecks.length > 1 ? `${glance.dailyDecks.length} decks` : glance.dailyDecks[0]?.title ?? "ready",
      href: `/thinktank/${firstDeckId}`,
      weight: evening ? 2 : 4,
    });
  }
  if (glance.tasksDueToday > 0) {
    chips.push({
      key: "tasks",
      icon: CheckSquare,
      label: `${glance.tasksDueToday} task${glance.tasksDueToday === 1 ? "" : "s"} today`,
      sub: "due",
      href: "/study?tab=tasks",
      weight: 2,
    });
  }
  if (chips.length === 0) return null;

  chips.sort((a, b) => b.weight - a.weight);

  return (
    <section className="not-prose mb-7">
      <div className="editorial-eyebrow mb-2.5">
        {evening ? "Wind down" : "At a glance"}
      </div>
      <div className="flex flex-wrap gap-2">
        {chips.map((c) => {
          const Icon = c.icon;
          return (
            <Link
              key={c.key}
              href={c.href}
              prefetch={true}
              className="group inline-flex items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2 text-sm transition-colors hover:border-brand/50 hover:bg-accent/50"
            >
              <Icon className="h-4 w-4 shrink-0" style={{ color: "hsl(var(--brand))" }} />
              <span className="min-w-0">
                <span className="font-semibold">{c.label}</span>
                <span className="ml-1.5 text-xs text-muted-foreground">{c.sub}</span>
              </span>
              <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
            </Link>
          );
        })}
      </div>
    </section>
  );
}
