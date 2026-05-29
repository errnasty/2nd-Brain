import { describe, expect, it } from "vitest";
import { CHAT_MODELS, DEFAULT_CHAT_MODEL, getChatModel } from "./models";

describe("getChatModel", () => {
  it("returns the requested model when valid", () => {
    expect(getChatModel("gpt-4o").id).toBe("gpt-4o");
    expect(getChatModel("gpt-4o").provider).toBe("openai");
  });

  it("falls back to the default for unknown ids", () => {
    expect(getChatModel("does-not-exist").id).toBe(DEFAULT_CHAT_MODEL);
    expect(getChatModel(undefined).id).toBe(DEFAULT_CHAT_MODEL);
  });

  it("default model is in the list and is anthropic", () => {
    const def = CHAT_MODELS.find((m) => m.id === DEFAULT_CHAT_MODEL);
    expect(def).toBeDefined();
    expect(def?.provider).toBe("anthropic");
  });
});
