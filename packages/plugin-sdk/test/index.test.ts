import { describe, expect, it } from "vitest";
import { definePlugin } from "../src/index";

describe("definePlugin", () => {
  it("returns the plugin and validates the id", () => {
    const plugin = definePlugin({ id: "demo", tools: [] });
    expect(plugin.id).toBe("demo");
    expect(() => definePlugin({ id: "" })).toThrow("Plugin id");
  });
});
