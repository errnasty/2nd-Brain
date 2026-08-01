import { describe, expect, it } from "vitest";
import {
  CHAT_MODELS,
  DEFAULT_CHAT_MODEL,
  REASONING_TOKEN_HEADROOM,
  getChatModel,
  quietReasoningOptions,
  reservesReasoningTokens,
  withReasoningHeadroom,
} from "./models";

describe("getChatModel", () => {
  it("returns the requested model when valid", () => {
    expect(getChatModel("gpt-5-mini").id).toBe("gpt-5-mini");
    expect(getChatModel("gpt-5-mini").provider).toBe("openai");
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

describe("reasoning headroom", () => {
  it("adds headroom for providers that think before answering", () => {
    expect(reservesReasoningTokens("openrouter")).toBe(true);
    expect(reservesReasoningTokens("openai")).toBe(true);
    expect(withReasoningHeadroom(420, "openrouter")).toBe(420 + REASONING_TOKEN_HEADROOM);
  });

  // Anthropic only thinks when explicitly asked, so its budgets stay exact —
  // padding them would slow the brief's sections for no reason.
  it("leaves anthropic budgets untouched", () => {
    expect(reservesReasoningTokens("anthropic")).toBe(false);
    expect(withReasoningHeadroom(420, "anthropic")).toBe(420);
  });
});

describe("quietReasoningOptions", () => {
  it("asks OpenRouter to skip its reasoning pass", () => {
    expect(quietReasoningOptions("openrouter", "deepseek/deepseek-v4-flash-0731")).toEqual({
      openrouter: { reasoning: { enabled: false } },
    });
  });

  it("asks GPT-5 class models for minimal reasoning effort", () => {
    expect(quietReasoningOptions("openai", "gpt-5-mini")).toEqual({
      openai: { reasoningEffort: "minimal" },
    });
  });

  // `reasoning_effort` is rejected outright by OpenAI's non-reasoning models,
  // so sending it blindly would break the models it is meant to protect.
  it("sends nothing for models with no reasoning knob", () => {
    expect(quietReasoningOptions("openai", "gpt-4o-mini")).toBeUndefined();
    expect(quietReasoningOptions("anthropic", "claude-sonnet-4-6")).toBeUndefined();
  });
});
