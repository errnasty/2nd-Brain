/**
 * Why a story is high in a trending list, in words.
 *
 * ## Why this exists
 *
 * The trending pass measures four separate things about a story — how many
 * independent outlets carried it, how fast they arrived, how hard the wider
 * news world is pushing it, and how close it sits to what the reader saves —
 * and writes all four onto `story_clusters`. The Feeds row showed one: "6
 * sources". So the ranking was doing far more than it could account for, and a
 * reader who disagreed with a placement had nothing to disagree WITH.
 *
 * That matters more than it sounds. A ranking you can't inspect is a ranking
 * you eventually stop trusting, and the honest response to not trusting a sort
 * order is to switch back to reverse-chronological — which throws away the
 * whole feature. One short, specific line of evidence per row is what keeps it
 * arguable: "9 outlets in 2h" is a claim the reader can check against the
 * story and either accept or hold against the algorithm.
 *
 * ## Why it's pure
 *
 * Same reasoning as `src/lib/trending/score.ts`: the thresholds below are the
 * product decision about what counts as burst, breadth or noise, and they're
 * worth having in one testable place rather than inline in JSX.
 */

/** The cluster fields a row carries. All nullable — the join may not match. */
export type TrendClusterInfo = {
  /** DISTINCT feeds carrying the story. */
  sourceCount?: number | null;
  /** Earliest telling in the user's feeds. */
  firstSeen?: Date | string | null;
  /** Most recent telling. */
  lastSeen?: Date | string | null;
  /** External heat, 0–1, from the public signals. */
  externalVolume?: number | null;
};

export type TrendReason = {
  /** Chip text. Kept to a few characters — it sits in a dense row. */
  label: string;
  /** The full picture, for the row's tooltip. One sentence. */
  detail: string;
  /** Burst stories are worth a warmer chip than merely broad ones. */
  kind: "burst" | "broad" | "external";
};

/**
 * Hours within which a set of outlets arriving counts as a burst rather than
 * as steady coverage. Three is deliberately tight: half a working day of
 * outlets picking something up is normal, and calling that "breaking" would
 * make the word meaningless on a busy desk.
 */
export const BURST_WINDOW_HOURS = 3;

/**
 * External heat that justifies a chip on its own, with no corroboration in the
 * user's own feeds. High, because this is the borrowed signal: saying "big
 * elsewhere" about a story the reader's own outlets ignored is a claim worth
 * making only when the outside world is unambiguous about it.
 */
export const EXTERNAL_CHIP_THRESHOLD = 0.55;

const HOUR_MS = 60 * 60 * 1000;

function asDate(v: Date | string | null | undefined): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === "string") {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** "2h", "45m", "3d" — the span outlets took to converge. */
function humanSpan(hours: number): string {
  if (hours < 1) return `${Math.max(5, Math.round(hours * 60))}m`;
  if (hours < 48) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}

/**
 * The one thing most worth saying about this story's placement, or null when
 * there is nothing to say.
 *
 * Null is the common case and the important one: a story carried by a single
 * feed with no external heat is every other article in the list, and a chip on
 * every row is the same as a chip on none. Silence is what makes the chip mean
 * something when it does appear.
 */
export function trendReason(cluster: TrendClusterInfo | null | undefined): TrendReason | null {
  if (!cluster) return null;
  const sources = cluster.sourceCount ?? 0;
  const external = cluster.externalVolume ?? 0;

  if (sources < 2) {
    // No corroboration in the reader's own feeds. Only the outside world can
    // justify a chip here, and only when it is shouting.
    if (external >= EXTERNAL_CHIP_THRESHOLD) {
      return {
        kind: "external",
        label: "big elsewhere",
        detail:
          "Only one of your feeds carried this, but it is being covered heavily outside them.",
      };
    }
    return null;
  }

  const first = asDate(cluster.firstSeen);
  const last = asDate(cluster.lastSeen);
  const spanHours = first && last ? Math.max(0, (last.getTime() - first.getTime()) / HOUR_MS) : null;
  const alsoOutside =
    external >= EXTERNAL_CHIP_THRESHOLD ? " The wider news world is on it too." : "";

  if (spanHours !== null && spanHours <= BURST_WINDOW_HOURS) {
    const span = humanSpan(spanHours);
    return {
      kind: "burst",
      label: `${sources} outlets in ${span}`,
      detail: `${sources} of your feeds carried this within ${span} of each other — outlets converging that fast is what the trending sort is looking for.${alsoOutside}`,
    };
  }

  // Broad but not fast. Still the backbone of the score, so it keeps a chip —
  // the span goes in the tooltip rather than the label, because "9 sources over
  // 2d" reads as a reason to skip and the count alone does not.
  const over = spanHours !== null && spanHours > 0 ? ` over ${humanSpan(spanHours)}` : "";
  return {
    kind: "broad",
    label: `${sources} sources`,
    detail: `${sources} of your feeds carried this story${over}.${alsoOutside}`,
  };
}
