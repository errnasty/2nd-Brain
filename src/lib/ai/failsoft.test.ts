import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { distill } from "./distill";
import { editAssist } from "./edit-assist";
import { generateFlashcards } from "./flashcards";
import { generateQuiz } from "./quiz";
import { classifyItemSkills } from "@/lib/gamify/skill-classifier";

// These AI helpers must degrade quietly (never throw) when NO provider key is
// configured — callers depend on the [] / null fallback. Both provider keys
// (and the override) are cleared so aiAvailable() is genuinely false.
describe("AI helpers fail soft", () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  const savedOr = process.env.OPENROUTER_API_KEY;
  const savedProvider = process.env.AI_PROVIDER;
  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.AI_PROVIDER;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = saved;
    if (savedOr === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = savedOr;
    if (savedProvider === undefined) delete process.env.AI_PROVIDER;
    else process.env.AI_PROVIDER = savedProvider;
  });

  it("generateFlashcards returns [] with no key", async () => {
    await expect(generateFlashcards("Title", "lots of content here")).resolves.toEqual([]);
  });

  it("generateQuiz returns [] with no key", async () => {
    await expect(generateQuiz([{ title: "Title", text: "lots of content here" }])).resolves.toEqual([]);
  });

  it("distill returns null with no key", async () => {
    await expect(distill("Title", "lots of content here")).resolves.toBeNull();
  });

  it("classifyItemSkills returns null with no key", async () => {
    await expect(classifyItemSkills("Title", "content", [])).resolves.toBeNull();
  });

  it("editAssist returns null with no key", async () => {
    const ctx = { title: "Title", before: "", after: "" };
    await expect(editAssist("rewrite", "some selected text", ctx)).resolves.toBeNull();
    await expect(editAssist("continue", "", ctx)).resolves.toBeNull();
  });

  it("guards empty content even when a key is present (no network call)", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key-not-used";
    await expect(generateFlashcards("Title", "   ")).resolves.toEqual([]);
    await expect(generateQuiz([{ title: "Title", text: "   " }])).resolves.toEqual([]);
    await expect(distill("Title", "")).resolves.toBeNull();
    await expect(classifyItemSkills("", "", [])).resolves.toBeNull();
    await expect(
      editAssist("rewrite", "   ", { title: "Title", before: "", after: "" }),
    ).resolves.toBeNull();
  });
});
