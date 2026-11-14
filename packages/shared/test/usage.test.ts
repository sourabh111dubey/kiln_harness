import { describe, expect, it } from "vitest";
import {
  addUsage,
  emptyUsage,
  estimateCost,
  formatModelRef,
  type ModelInfo,
  parseModelRef,
} from "../src/usage";

const model: ModelInfo = {
  id: "claude-sonnet-4-5",
  provider: "anthropic",
  name: "Claude Sonnet 4.5",
  contextWindow: 200_000,
  maxOutput: 64_000,
  pricing: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  capabilities: {
    tools: true,
    vision: true,
    reasoning: true,
    promptCache: true,
    streaming: true,
    maxContext: 200_000,
  },
};

describe("usage", () => {
  it("adds usage counters", () => {
    expect(
      addUsage(
        { input: 10, output: 5, cacheRead: 1, cacheWrite: 2, reasoning: 1 },
        { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, reasoning: 1 },
      ),
    ).toEqual({ input: 11, output: 7, cacheRead: 4, cacheWrite: 6, reasoning: 2 });
  });

  it("starts from an empty usage", () => {
    expect(emptyUsage()).toEqual({
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      reasoning: 0,
    });
  });

  it("parses and formats model refs", () => {
    expect(parseModelRef("anthropic/claude-sonnet-4-5")).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-4-5",
    });
    expect(parseModelRef("nope")).toBeNull();
    expect(formatModelRef({ provider: "openai", model: "gpt-5" })).toBe("openai/gpt-5");
  });

  it("estimates cost from per-million pricing", () => {
    const cost = estimateCost(model, {
      input: 1_000_000,
      output: 1_000_000,
      cacheRead: 1_000_000,
      cacheWrite: 1_000_000,
    });
    expect(cost).toBeCloseTo(3 + 15 + 0.3 + 3.75, 10);
  });
});
