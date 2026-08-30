import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The lite chain exists so a flaky free model costs a retry rather than a
 * feature. These cover the case that actually bit: every OpenRouter tier
 * failing at once because a slug went stale, while a working Anthropic key sat
 * unused and tagging silently produced nothing.
 */

const anthropicRescue = { id: "anthropic-rescue" } as never;
const fastModel = { id: "fast" } as never;

const state = {
  freeSlugs: [] as string[],
  hasOpenrouterKey: true,
  rescue: null as unknown,
};

vi.mock("./provider", () => ({
  openrouterKey: () => (state.hasOpenrouterKey ? "key" : undefined),
  openrouterClient: () => (slug: string) => ({ id: slug }),
  anthropicRescueModel: () => state.rescue,
}));

vi.mock("./user-model", () => ({
  userFastModel: async () => fastModel,
}));

const { withLiteModel } = await import("./lite");

beforeEach(() => {
  state.freeSlugs = [];
  state.hasOpenrouterKey = true;
  state.rescue = null;
  process.env.OPENROUTER_LITE_MODELS = "";
  vi.restoreAllMocks();
});

function withSlugs(slugs: string[]) {
  process.env.OPENROUTER_LITE_MODELS = slugs.join(",");
}

describe("withLiteModel", () => {
  it("uses the first free model that works", async () => {
    withSlugs(["free-a", "free-b"]);
    const seen: string[] = [];
    const result = await withLiteModel(async (m) => {
      seen.push((m as unknown as { id: string }).id);
      return "ok";
    });
    expect(result).toBe("ok");
    expect(seen).toEqual(["free-a"]);
  });

  it("falls through a failing free model to the next", async () => {
    withSlugs(["free-a", "free-b"]);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const seen: string[] = [];
    const result = await withLiteModel(async (m) => {
      const id = (m as unknown as { id: string }).id;
      seen.push(id);
      if (id === "free-a") throw new Error("No endpoints found for free-a.");
      return "ok";
    });
    expect(result).toBe("ok");
    expect(seen).toEqual(["free-a", "free-b"]);
  });

  it("falls through to the fast model when every free model fails", async () => {
    withSlugs(["free-a"]);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const seen: string[] = [];
    await withLiteModel(async (m) => {
      const id = (m as unknown as { id: string }).id;
      seen.push(id);
      if (id === "free-a") throw new Error("Invalid JSON response");
      return "ok";
    });
    expect(seen).toEqual(["free-a", "fast"]);
  });

  it("rescues with Anthropic when the fast model fails too", async () => {
    // The real failure: a retired OpenRouter slug means every tier is dead,
    // because setting OPENROUTER_API_KEY makes OpenRouter every tier.
    state.rescue = anthropicRescue;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const seen: string[] = [];
    const result = await withLiteModel(async (m) => {
      const id = (m as unknown as { id: string }).id;
      seen.push(id);
      if (id !== "anthropic-rescue") throw new Error("Provider returned error");
      return "tagged";
    });
    expect(result).toBe("tagged");
    expect(seen).toEqual(["fast", "anthropic-rescue"]);
  });

  it("propagates the fast model's failure when there is nothing to rescue with", async () => {
    state.rescue = null;
    await expect(
      withLiteModel(async () => {
        throw new Error("Provider returned error");
      }),
    ).rejects.toThrow("Provider returned error");
  });

  it("skips the free tier entirely without an OpenRouter key", async () => {
    state.hasOpenrouterKey = false;
    withSlugs(["free-a"]);
    const seen: string[] = [];
    await withLiteModel(async (m) => {
      seen.push((m as unknown as { id: string }).id);
      return "ok";
    });
    expect(seen).toEqual(["fast"]);
  });
});
