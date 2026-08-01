import { describe, expect, it } from "vitest";
import { QUIZ_BATCH, extractQuestions, normalizeQuestion } from "./quiz";

const mc = {
  type: "mc" as const,
  question: "What does TCP guarantee?",
  options: ["Ordering", "Speed", "Encryption", "Compression"],
  correctIndex: 0,
  explanation: "TCP re-orders and retransmits.",
};

describe("normalizeQuestion", () => {
  it("passes a well-formed multiple-choice question through", () => {
    expect(normalizeQuestion(mc)).toEqual(mc);
  });

  it("passes a well-formed open question through", () => {
    expect(normalizeQuestion({ type: "open", question: "Why use UDP?", answer: "Lower latency." })).toEqual({
      type: "open",
      question: "Why use UDP?",
      answer: "Lower latency.",
    });
  });

  // The UI renders exactly four choices; three can't be shown and five leaves
  // the correct index ambiguous.
  it("drops a multiple-choice question without exactly four options", () => {
    expect(normalizeQuestion({ ...mc, options: ["a", "b", "c"] })).toBeNull();
    expect(normalizeQuestion({ ...mc, options: ["a", "b", "c", "d", "e"] })).toBeNull();
    expect(normalizeQuestion({ ...mc, options: undefined })).toBeNull();
  });

  it("drops a multiple-choice question whose options are not distinct", () => {
    // The exact budget-model failure: one distractor repeated 4×.
    expect(normalizeQuestion({ ...mc, options: ["Ordering", "Ordering", "Ordering", "Ordering"] })).toBeNull();
    expect(normalizeQuestion({ ...mc, options: ["a", "a", "b", "c"] })).toBeNull();
    // Case differences are the same option.
    expect(normalizeQuestion({ ...mc, options: ["Speed", "speed", "SPEED", "Encryption"] })).toBeNull();
  });

  it("drops a multiple-choice question whose answer index is out of range", () => {
    expect(normalizeQuestion({ ...mc, correctIndex: 7 })).toBeNull();
    expect(normalizeQuestion({ ...mc, correctIndex: -1 })).toBeNull();
  });

  // An explanation is nice, not load-bearing — the score works without it, so
  // losing the question over a missing one would be a bad trade.
  it("keeps a multiple-choice question that forgot its explanation", () => {
    const out = normalizeQuestion({ ...mc, explanation: undefined });
    expect(out).not.toBeNull();
    expect(out).toMatchObject({ type: "mc", explanation: "" });
  });

  it("drops an open question with no model answer", () => {
    expect(normalizeQuestion({ type: "open", question: "Why?", answer: undefined })).toBeNull();
    expect(normalizeQuestion({ type: "open", question: "Why?", answer: "   " })).toBeNull();
  });

  it("drops anything with no question text", () => {
    expect(normalizeQuestion({ ...mc, question: "   " })).toBeNull();
  });

  it("trims whitespace off options and text", () => {
    const out = normalizeQuestion({
      ...mc,
      question: "  Padded?  ",
      options: [" a ", "b", "c", "d"],
    });
    expect(out).toMatchObject({ question: "Padded?", options: ["a", "b", "c", "d"] });
  });
});

describe("QUIZ_BATCH", () => {
  // The whole point of batching is that one call stays short enough to finish
  // inside a serverless function's window.
  it("is small enough that one call is short", () => {
    expect(QUIZ_BATCH).toBeGreaterThan(0);
    expect(QUIZ_BATCH).toBeLessThanOrEqual(5);
  });
});

describe("extractQuestions", () => {
  const q = {
    type: "mc",
    question: "What does TCP guarantee?",
    options: ["Ordering", "Speed", "Encryption", "Compression"],
    correctIndex: 0,
    explanation: "TCP re-orders and retransmits.",
  };

  // These are the exact shapes a model produces that `generateObject` rejects
  // with "No object generated: could not parse the response" — the bug this
  // helper exists to survive.
  it("parses a bare JSON array in a ```json fence", () => {
    const out = extractQuestions("```json\n" + JSON.stringify([q]) + "\n```");
    expect(out).toHaveLength(1);
    expect(out[0].question).toBe(q.question);
  });

  it("parses the contract shape wrapped in a ```json fence", () => {
    const reply = "Here you go:\n```json\n" + JSON.stringify({ questions: [q, q] }) + "\n```";
    expect(extractQuestions(reply)).toHaveLength(2);
  });

  it("parses the contract shape with prose on both sides", () => {
    const reply = "Sure. " + JSON.stringify({ questions: [q] }) + " Hope that helps.";
    expect(extractQuestions(reply)).toHaveLength(1);
  });

  it("returns [] when there is no JSON object to parse", () => {
    expect(extractQuestions("I can't do that.")).toEqual([]);
    expect(extractQuestions("")).toEqual([]);
  });

  // The reason the user's model failed: its reply led with reasoning prose
  // (which itself contained braces), so a naive first-`{`→last-`}` slice
  // spanned garbage and never parsed. The scanner must hop over invalid
  // fragments and land on the real JSON.
  it("skips reasoning prose containing braces before the JSON", () => {
    const reply =
      "Let me weigh {which concepts matter most} and {plausible distractors}. Final answer:\n" +
      JSON.stringify({ questions: [q] });
    expect(extractQuestions(reply)).toHaveLength(1);
    expect(extractQuestions(reply)[0].question).toBe(q.question);
  });

  it("recovers the contract shape even after a nested object in prose", () => {
    const reply = "Details: {\"x\":1}. Now:\n```json\n" + JSON.stringify({ questions: [q] }) + "\n```";
    expect(extractQuestions(reply)).toHaveLength(1);
  });
});
