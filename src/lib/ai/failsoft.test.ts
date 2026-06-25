import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { distill } from "./distill";
import { generateFlashcards } from "./flashcards";
import { classifyItemSkills } from "@/lib/gamify/skill-classifier";

// These AI helpers must degrade quietly (never throw) when the API key is
// missing or the input is empty — callers depend on the [] / null fallback.
describe("AI helpers fail soft", () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = saved;
  });

  it("generateFlashcards returns [] with no key", async () => {
    await expect(generateFlashcards("Title", "lots of content here")).resolves.toEqual([]);
  });

  it("distill returns null with no key", async () => {
    await expect(distill("Title", "lots of content here")).resolves.toBeNull();
  });

  it("classifyItemSkills returns null with no key", async () => {
    await expect(classifyItemSkills("Title", "content", [])).resolves.toBeNull();
  });

  it("guards empty content even when a key is present (no network call)", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key-not-used";
    await expect(generateFlashcards("Title", "   ")).resolves.toEqual([]);
    await expect(distill("Title", "")).resolves.toBeNull();
    await expect(classifyItemSkills("", "", [])).resolves.toBeNull();
  });
});
