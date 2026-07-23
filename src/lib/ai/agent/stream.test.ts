import { describe, expect, it } from "vitest";
import { encodeEvent, parseEvents, type AgentEvent } from "./stream";

describe("agent stream codec", () => {
  it("round-trips events through encode → parse", () => {
    const events: AgentEvent[] = [
      { type: "tool", id: "1", label: "Searching your library", status: "start" },
      { type: "text", delta: "Hello " },
      { type: "text", delta: "world" },
      { type: "usage", usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } },
    ];
    const wire = events.map(encodeEvent).join("");
    const { events: parsed, rest } = parseEvents(wire);
    expect(parsed).toEqual(events);
    expect(rest).toBe("");
  });

  it("holds back a trailing partial line for the next chunk", () => {
    const complete = encodeEvent({ type: "text", delta: "a" });
    const partial = '{"type":"text","delta":"b';
    const { events, rest } = parseEvents(complete + partial);
    expect(events).toEqual([{ type: "text", delta: "a" }]);
    expect(rest).toBe(partial);
    // Completing the partial in the next buffer yields the second event.
    const next = parseEvents(rest + '"}\n');
    expect(next.events).toEqual([{ type: "text", delta: "b" }]);
  });

  it("skips malformed lines without aborting", () => {
    const wire = "not json\n" + encodeEvent({ type: "note", message: "ok" });
    const { events } = parseEvents(wire);
    expect(events).toEqual([{ type: "note", message: "ok" }]);
  });
});
