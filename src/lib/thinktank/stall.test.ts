import { describe, expect, it } from "vitest";
import {
  GENERATION_STALL_MS,
  deckDisplayState,
  isPollable,
  isReadable,
  isStalledGeneration,
} from "./stall";

const NOW = new Date("2026-07-31T14:00:00Z").getTime();
const agoMs = (ms: number) => new Date(NOW - ms).toISOString();

describe("isStalledGeneration", () => {
  it("is false for a run that started just now", () => {
    expect(isStalledGeneration(agoMs(1000), NOW)).toBe(false);
  });

  it("is true past the stall window", () => {
    expect(isStalledGeneration(agoMs(GENERATION_STALL_MS + 1000), NOW)).toBe(true);
  });

  // The regression this file exists for. `NaN > LIMIT` is false, so an
  // unreadable timestamp used to report "still going" and pin the deck on a
  // spinner that could never resolve.
  it("treats an unparseable timestamp as stalled, not as fresh", () => {
    expect(isStalledGeneration("not a date", NOW)).toBe(true);
    expect(isStalledGeneration("", NOW)).toBe(true);
  });

  // Postgres timestamptz::text — a space instead of "T". V8 parses it, Safari
  // does not. Either way it must not read as "fresh forever".
  it("handles Postgres ::text output without reporting fresh", () => {
    const pgText = "2026-07-31 13:00:00.123456+00";
    expect(typeof isStalledGeneration(pgText, NOW)).toBe("boolean");
    expect(isStalledGeneration(pgText, NOW)).toBe(true);
  });

  it("accepts a Date as well as a string", () => {
    expect(isStalledGeneration(new Date(NOW - 1000), NOW)).toBe(false);
  });
});

describe("deckDisplayState", () => {
  const deck = (over: Partial<{ cardCount: number; status: string; updatedAt: string }> = {}) => ({
    cardCount: 0,
    status: "generating",
    updatedAt: agoMs(1000),
    ...over,
  });

  it("is ready when a finished deck has cards", () => {
    expect(deckDisplayState(deck({ cardCount: 12, status: "ready" }), NOW)).toBe("ready");
  });

  // Stepped builds write cards as they go, so "generating with cards" is a
  // deck you can already read while the rest is still being written.
  it("is filling when a live build has written some cards", () => {
    expect(deckDisplayState(deck({ cardCount: 4, status: "generating" }), NOW)).toBe("filling");
  });

  // Labelling it "Failed" would hide cards the user can actually read.
  it("stays readable when an errored deck still has cards", () => {
    expect(deckDisplayState(deck({ cardCount: 12, status: "error" }), NOW)).toBe("ready");
  });

  it("is building while a fresh run is in flight", () => {
    expect(deckDisplayState(deck(), NOW)).toBe("building");
  });

  it("is stalled when a generating run went quiet", () => {
    expect(deckDisplayState(deck({ updatedAt: agoMs(GENERATION_STALL_MS + 1) }), NOW)).toBe(
      "stalled",
    );
  });

  it("is failed when the builder wrote an error", () => {
    expect(deckDisplayState(deck({ status: "error" }), NOW)).toBe("failed");
  });

  // The gap that produced the eternal spinner: a run that finished as `ready`
  // but wrote no cards matched neither "stalled" nor "failed", so the UI fell
  // through to its default branch — "Building…", forever.
  it("is empty when a finished run produced no cards", () => {
    expect(deckDisplayState(deck({ status: "ready" }), NOW)).toBe("empty");
  });

  it("never reports building for a status it doesn't know", () => {
    expect(deckDisplayState(deck({ status: "something_new" }), NOW)).toBe("empty");
  });
});

describe("isPollable", () => {
  // Polling anything else is what made the hub hit the server every 3 seconds
  // for a deck whose state could never change.
  it("polls only states that can still change on their own", () => {
    expect(isPollable("building")).toBe(true);
    expect(isPollable("filling")).toBe(true);
    for (const s of ["stalled", "failed", "empty", "ready"] as const) {
      expect(isPollable(s)).toBe(false);
    }
  });
});

describe("isReadable", () => {
  it("opens a deck that has cards, finished or still filling", () => {
    expect(isReadable("ready")).toBe(true);
    expect(isReadable("filling")).toBe(true);
    for (const s of ["building", "stalled", "failed", "empty"] as const) {
      expect(isReadable(s)).toBe(false);
    }
  });
});
