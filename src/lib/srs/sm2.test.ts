import { describe, it, expect } from "vitest";
import { scheduleSm2, initialSm2, MIN_EASE } from "./sm2";

const now = new Date("2026-06-06T00:00:00Z");
const daysBetween = (a: Date, b: Date) => Math.round((a.getTime() - b.getTime()) / 86_400_000);

describe("scheduleSm2", () => {
  it("first successful review → 1 day", () => {
    const r = scheduleSm2(initialSm2(), 4, now);
    expect(r.repetitions).toBe(1);
    expect(r.intervalDays).toBe(1);
    expect(daysBetween(r.dueDate, now)).toBe(1);
  });

  it("second successful review → 6 days", () => {
    const r = scheduleSm2({ ease: 2.5, intervalDays: 1, repetitions: 1 }, 4, now);
    expect(r.repetitions).toBe(2);
    expect(r.intervalDays).toBe(6);
  });

  it("third review multiplies interval by ease", () => {
    const r = scheduleSm2({ ease: 2.5, intervalDays: 6, repetitions: 2 }, 4, now);
    expect(r.repetitions).toBe(3);
    expect(r.intervalDays).toBe(Math.round(6 * r.ease));
  });

  it("lapse (q<3) resets reps and schedules tomorrow", () => {
    const r = scheduleSm2({ ease: 2.5, intervalDays: 20, repetitions: 5 }, 1, now);
    expect(r.repetitions).toBe(0);
    expect(r.intervalDays).toBe(1);
  });

  it("ease never drops below 1.3", () => {
    let s = { ease: 1.4, intervalDays: 1, repetitions: 1 };
    for (let i = 0; i < 10; i += 1) s = scheduleSm2(s, 0, now);
    expect(s.ease).toBeGreaterThanOrEqual(MIN_EASE);
  });

  it("ease rises on perfect, falls on hard", () => {
    expect(scheduleSm2(initialSm2(), 5, now).ease).toBeGreaterThan(2.5);
    expect(scheduleSm2(initialSm2(), 3, now).ease).toBeLessThan(2.5);
  });

  it("clamps out-of-range quality", () => {
    expect(() => scheduleSm2(initialSm2(), 99, now)).not.toThrow();
    expect(scheduleSm2(initialSm2(), 99, now).repetitions).toBe(1);
  });
});
