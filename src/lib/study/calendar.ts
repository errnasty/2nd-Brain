// Pure calendar grid helpers. Db-free + runtime-free.

export type CalDay = {
  date: Date;
  key: string; // YYYY-MM-DD
  inMonth: boolean;
  isToday: boolean;
};

/** Local YYYY-MM-DD key (calendar cells are shown in the user's local time). */
export function localKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * UTC YYYY-MM-DD key. Task due dates are date-only values persisted at UTC
 * midnight; bucketing/formatting them in the browser's local zone shifts a
 * (due: 30th) task to the 29th in the Americas. Read them back in UTC instead.
 */
export function utcKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * 6×7 month grid (Sunday-first) covering `month` (0-based) of `year`, padded
 * with the trailing/leading days of adjacent months.
 */
export function buildMonthGrid(year: number, month: number, today: Date = new Date()): CalDay[][] {
  const first = new Date(year, month, 1);
  const start = new Date(first);
  start.setDate(1 - first.getDay()); // back up to the Sunday on/before the 1st

  const todayKey = localKey(today);
  const weeks: CalDay[][] = [];
  const cursor = new Date(start);
  for (let w = 0; w < 6; w += 1) {
    const week: CalDay[] = [];
    for (let d = 0; d < 7; d += 1) {
      week.push({
        date: new Date(cursor),
        key: localKey(cursor),
        inMonth: cursor.getMonth() === month,
        isToday: localKey(cursor) === todayKey,
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
