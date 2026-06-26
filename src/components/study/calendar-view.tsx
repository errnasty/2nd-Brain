"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, CheckSquare, Brain, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  buildMonthGrid,
  localKey,
  MONTH_NAMES,
  WEEKDAY_LABELS,
} from "@/lib/study/calendar";
import { fetchCalendarRange, type CalendarEntry } from "@/app/(app)/study/actions";

/** Month range [first day 00:00, last day 23:59] as ISO for a given year/month. */
function monthRange(year: number, month: number) {
  const from = new Date(year, month, 1, 0, 0, 0);
  const to = new Date(year, month + 1, 0, 23, 59, 59);
  return { fromISO: from.toISOString(), toISO: to.toISOString() };
}

export function CalendarView({ initial }: { initial: CalendarEntry[] }) {
  const router = useRouter();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [entries, setEntries] = useState<CalendarEntry[]>(initial);
  const [selected, setSelected] = useState<string>(localKey(now));
  const [loadingMonth, setLoadingMonth] = useState(false);
  const [monthError, setMonthError] = useState(false);

  const grid = useMemo(() => buildMonthGrid(year, month), [year, month]);

  // Bucket entries by day key. Tasks are date-only values stored at UTC
  // midnight, so bucket them by their UTC calendar date (the YYYY-MM-DD prefix)
  // — otherwise a US-timezone browser renders a (due: 30th) task on the 29th.
  // Flashcards carry a real timestamp, so their local day is correct.
  const byDay = useMemo(() => {
    const m = new Map<string, CalendarEntry[]>();
    for (const e of entries) {
      const k = e.kind === "task" ? e.due.slice(0, 10) : localKey(new Date(e.due));
      (m.get(k) ?? m.set(k, []).get(k)!).push(e);
    }
    return m;
  }, [entries]);

  function loadMonth(y: number, mo: number) {
    const { fromISO, toISO } = monthRange(y, mo);
    setLoadingMonth(true);
    setMonthError(false);
    fetchCalendarRange(fromISO, toISO)
      .then((e) => {
        setEntries(e);
        setMonthError(false);
      })
      // Don't silently blank the grid on failure — surface an error + retry.
      .catch(() => setMonthError(true))
      .finally(() => setLoadingMonth(false));
  }

  function go(delta: number) {
    let y = year;
    let mo = month + delta;
    if (mo < 0) {
      mo = 11;
      y -= 1;
    } else if (mo > 11) {
      mo = 0;
      y += 1;
    }
    setYear(y);
    setMonth(mo);
    // Reset the selected day to the new month's 1st so the detail panel doesn't
    // keep showing a day from the previous month.
    setSelected(localKey(new Date(y, mo, 1)));
    loadMonth(y, mo);
  }

  const selectedEntries = byDay.get(selected) ?? [];

  return (
    <div className="mx-auto max-w-2xl px-6 py-6">
      <div className="editorial-eyebrow mb-1.5">Study · Calendar</div>
      <div className="mb-4 flex items-end justify-between gap-3 editorial-rule pb-3">
        <h1 className="editorial-display m-0 flex items-center gap-2" style={{ fontSize: "clamp(1.5rem, 3vw, 2rem)" }}>
          {MONTH_NAMES[month]} {year}
          {loadingMonth && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </h1>
        <div className="flex items-center gap-1">
          <button onClick={() => go(-1)} className="rounded p-1 hover:bg-accent" title="Previous month">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button onClick={() => go(1)} className="rounded p-1 hover:bg-accent" title="Next month">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {monthError && (
        <div className="mb-3 flex items-center justify-between rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <span>Couldn&apos;t load this month.</span>
          <button onClick={() => loadMonth(year, month)} className="font-medium underline underline-offset-2">
            Retry
          </button>
        </div>
      )}

      <div className="grid grid-cols-7 gap-1 text-center font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
        {WEEKDAY_LABELS.map((d) => (
          <div key={d} className="py-1">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {grid.flat().map((day) => {
          const items = byDay.get(day.key) ?? [];
          const tasks = items.filter((i) => i.kind === "task").length;
          const cards = items.filter((i) => i.kind === "card").length;
          return (
            <button
              key={day.key}
              onClick={() => setSelected(day.key)}
              className={cn(
                "flex aspect-square flex-col items-center justify-start rounded-md border p-1 text-xs transition-colors",
                day.inMonth ? "border-border" : "border-transparent text-muted-foreground/40",
                day.isToday && "ring-1 ring-brand",
                selected === day.key && "bg-accent",
              )}
            >
              <span className={cn("tabular-nums", day.isToday && "font-semibold text-brand")}>
                {day.date.getDate()}
              </span>
              <span className="mt-auto flex gap-0.5">
                {tasks > 0 && <span className="h-1.5 w-1.5 rounded-full bg-sky-500" />}
                {cards > 0 && <span className="h-1.5 w-1.5 rounded-full" style={{ background: "hsl(var(--brand))" }} />}
              </span>
            </button>
          );
        })}
      </div>

      {/* Selected day detail */}
      <div className="mt-6">
        <div className="editorial-section-row mb-2">
          <span className="editorial-eyebrow-brand">§ {selected}</span>
          <span className="editorial-section-rule" />
        </div>
        {selectedEntries.length === 0 ? (
          <div className="text-sm italic text-muted-foreground">Nothing scheduled.</div>
        ) : (
          <ul className="space-y-1">
            {selectedEntries.map((e) => (
              <li key={e.id}>
                <button
                  onClick={() => e.kind === "card" ? router.push("/study?tab=review") : router.push("/study?tab=tasks")}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent/50"
                >
                  {e.kind === "task" ? (
                    <CheckSquare className="h-3.5 w-3.5 shrink-0 text-sky-500" />
                  ) : (
                    <Brain className="h-3.5 w-3.5 shrink-0" style={{ color: "hsl(var(--brand))" }} />
                  )}
                  <span className="truncate">{e.text}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
