import { describe, expect, it } from "vitest";
import { availableProviderIds, createDefaultProviderRegistry } from "../src/provider/registry";

describe("provider registry", () => {
  it("always registers ollama", () => {
    const registry = createDefaultProviderRegistry({});
    expect(registry.has("ollama")).toBe(true);
    expect(registry.get("ollama")?.id).toBe("ollama");
    expect(registry.list()).toHaveLength(1);
  });

  it("registers providers based on environment", () => {
    const registry = createDefaultProviderRegistry({
      ANTHROPIC_API_KEY: "a",
      OPENAI_API_KEY: "o",
      GEMINI_API_KEY: "g",
      OPENROUTER_API_KEY: "or",
      KILN_CUSTOM_BASE_URL: "http://localhost:9999/v1",
    });

    expect(registry.has("anthropic")).toBe(true);
    expect(registry.has("openai")).toBe(true);
    expect(registry.has("gemini")).toBe(true);
    expect(registry.has("custom")).toBe(true);
    expect(registry.has("openrouter")).toBe(true);
    expect(registry.get("missing")).toBeUndefined();
  });

  it("reports configured provider ids", () => {
    expect(availableProviderIds({})).toEqual(["ollama"]);
    expect(
      availableProviderIds({
        ANTHROPIC_API_KEY: "a",
        OPENAI_API_KEY: "o",
        OPENROUTER_API_KEY: "r",
      }),
    ).toEqual(expect.arrayContaining(["ollama", "anthropic", "openai", "openrouter"]));
  });
});
