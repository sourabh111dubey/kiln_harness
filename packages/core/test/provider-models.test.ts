import { describe, expect, it } from "vitest";
import { listKnownModels, modelInfoFor } from "../src/provider/models";

describe("model catalog", () => {
  it("returns known model metadata", () => {
    const model = modelInfoFor("anthropic", "claude-sonnet-4-5");
    expect(model.name).toBe("Claude Sonnet 4.5");
    expect(model.contextWindow).toBe(200_000);
    expect(model.pricing.input).toBe(3);
    expect(model.capabilities.tools).toBe(true);
  });

  it("falls back to conservative defaults", () => {
    const model = modelInfoFor("openai", "gpt-unknown");
    expect(model.id).toBe("gpt-unknown");
    expect(model.contextWindow).toBe(128_000);
    expect(model.pricing.input).toBe(0);
    expect(model.capabilities.vision).toBe(false);
  });

  it("lists the bundled catalog", () => {
    const models = listKnownModels();
    expect(models.length).toBeGreaterThan(0);
    expect(models.some((model) => model.provider === "anthropic")).toBe(true);
  });
});
