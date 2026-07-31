"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { celebrate } from "@/lib/gamify/celebrate";
import type { AwardResult } from "@/lib/gamify/award";

/**
 * Tracking which sections of the Daily Brief were actually READ, and claiming
 * the XP for them.
 *
 * ## What counts as read
 *
 * Not "rendered", and not "scrolled past". Both are trivially satisfied by
 * flicking to the bottom of the page, and a reward you get for not reading is
 * worse than no reward — it makes the number meaningless and it teaches the
 * habit backwards.
 *
 * So a section counts when it has been *substantially visible for a while*:
 * more than half of it on screen (or, for sections taller than the viewport, a
 * good part of the screen filled by it) continuously for DWELL_MS. Scrolling
 * away resets the timer; coming back starts it again.
 *
 * ## Why the amounts aren't here
 *
 * This hook reports only WHICH section was read. What that is worth, which
 * articles it covers and which folders they belong to are all decided by the
 * server (`/api/brief/xp`), because anything the client can name, the client
 * can lie about.
 */

/** Continuous visible time before a section counts as read. */
export const DWELL_MS = 3000;

/** Fraction of a section on screen that counts as "looking at it". */
const VISIBLE_RATIO = 0.5;

export type SkillGain = {
  name: string;
  emoji: string | null;
  amount: number;
  leveledUp: boolean;
};

export type BriefXpResponse = {
  awarded: number;
  skills: SkillGain[];
  streak?: number;
  /** The richest award of the batch, for `celebrate()` to act on. */
  best?: AwardResult;
};

export type BriefReading = {
  /** Section keys the reader has actually read. */
  readKeys: Set<string>;
  /** XP earned per section key this visit, for the inline "+4" markers. */
  gains: Map<string, SkillGain[]>;
  /** Total XP earned from the brief this visit. */
  earned: number;
  /** Consecutive days finishing the brief, once completion has been claimed. */
  streak: number | null;
  /** Attach to each section element. */
  register: (key: string) => (el: HTMLElement | null) => (() => void) | undefined;
  /** Call when a cited source is opened, to credit that article's folder. */
  reportSourceOpened: (articleId: string) => void;
};

async function claim(body: Record<string, unknown>): Promise<BriefXpResponse | null> {
  try {
    const res = await fetch("/api/brief/xp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as BriefXpResponse;
  } catch {
    // XP is a side effect of reading. Losing it to a flaky network must never
    // surface as an error on top of the thing the user came here to do.
    return null;
  }
}

export function useBriefReading(opts: {
  /** Keys of every section in the current plan, in order. */
  sectionKeys: string[];
  /** Whether a section has finished streaming — an empty one isn't readable. */
  isReadable: (key: string) => boolean;
  /** Level, so the server rebuilds the same plan the reader is looking at. */
  level: string;
  /** Disables tracking entirely (e.g. while the brief is still being planned). */
  enabled: boolean;
}): BriefReading {
  const { sectionKeys, isReadable, level, enabled } = opts;

  const [readKeys, setReadKeys] = useState<Set<string>>(new Set());
  const [gains, setGains] = useState<Map<string, SkillGain[]>>(new Map());
  const [earned, setEarned] = useState(0);
  const [streak, setStreak] = useState<number | null>(null);

  // Refs, not state: the observer callback must see current values without
  // being torn down and rebuilt on every scroll tick.
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const claimed = useRef(new Set<string>());
  const completed = useRef(false);
  const readableRef = useRef(isReadable);
  readableRef.current = isReadable;

  // A new plan (regenerate, re-plan, depth change) is a new brief: forget what
  // was read so its sections can be earned again. The server's idempotency is
  // what actually stops double-paying, so this is safe.
  const planId = sectionKeys.join("|");
  useEffect(() => {
    claimed.current = new Set();
    completed.current = false;
    setReadKeys(new Set());
    setGains(new Map());
  }, [planId]);

  const claimSection = useCallback(
    async (key: string) => {
      if (claimed.current.has(key)) return;
      claimed.current.add(key);
      setReadKeys((prev) => new Set(prev).add(key));

      const result = await claim({ kind: "section", section: key, level });
      if (!result || result.awarded <= 0) return;
      setEarned((prev) => prev + result.awarded);
      setGains((prev) => new Map(prev).set(key, result.skills));
      // Stays quiet for ordinary XP — it only fires on a milestone (a folder
      // skill levelling up, an evolution, a rank promotion).
      celebrate(result.best);
    },
    [level],
  );

  const register = useCallback(
    (key: string) => (el: HTMLElement | null) => {
      if (!el || !enabled) return;
      if (typeof IntersectionObserver === "undefined") return;

      const observer: IntersectionObserver = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const existing = timers.current.get(key);
            // A section taller than the viewport can never reach a 0.5 ratio,
            // so filling most of the screen counts too — otherwise long desks
            // would be the only ones that never pay.
            const viewportFilled =
              entry.rootBounds && entry.rootBounds.height > 0
                ? entry.intersectionRect.height / entry.rootBounds.height
                : 0;
            const looking =
              entry.isIntersecting &&
              (entry.intersectionRatio >= VISIBLE_RATIO || viewportFilled >= 0.6);

            if (looking && !claimed.current.has(key) && readableRef.current(key)) {
              if (!existing) {
                timers.current.set(
                  key,
                  setTimeout(() => {
                    timers.current.delete(key);
                    void claimSection(key);
                  }, DWELL_MS),
                );
              }
            } else if (existing) {
              // Scrolled away before the dwell elapsed — no partial credit.
              clearTimeout(existing);
              timers.current.delete(key);
            }
          }
        },
        { threshold: [0, VISIBLE_RATIO, 1] },
      );
      observer.observe(el);
      // React 19 ref cleanup. Without it a re-plan leaves one live observer per
      // section per generation, all still firing on scroll.
      return () => {
        observer.disconnect();
        const pending = timers.current.get(key);
        if (pending) {
          clearTimeout(pending);
          timers.current.delete(key);
        }
      };
    },
    [claimSection, enabled],
  );

  // Completion: every section that could be read, has been. Claimed once per
  // day server-side, so a re-plan mid-read can't double-pay it.
  useEffect(() => {
    if (!enabled || completed.current) return;
    const readable = sectionKeys.filter((k) => isReadable(k));
    if (readable.length === 0) return;
    if (!readable.every((k) => readKeys.has(k))) return;

    completed.current = true;
    void (async () => {
      const result = await claim({ kind: "complete", level });
      if (!result) return;
      if (typeof result.streak === "number") setStreak(result.streak);
      if (result.awarded > 0) {
        setEarned((prev) => prev + result.awarded);
        celebrate(result.best);
      }
    })();
  }, [readKeys, sectionKeys, isReadable, level, enabled]);

  const reportSourceOpened = useCallback((articleId: string) => {
    void (async () => {
      const result = await claim({ kind: "source", articleId });
      if (result && result.awarded > 0) {
        setEarned((prev) => prev + result.awarded);
        celebrate(result.best);
      }
    })();
  }, []);

  // Pending dwell timers must not fire after the component is gone.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const t of pending.values()) clearTimeout(t);
      pending.clear();
    };
  }, []);

  return { readKeys, gains, earned, streak, register, reportSourceOpened };
}
