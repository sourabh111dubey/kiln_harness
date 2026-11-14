import { describe, expect, it } from "vitest";
import { getConfigValue } from "../src/commands/config";
import { createProgram } from "../src/index";
import { readVersion } from "../src/version";

describe("cli", () => {
  it("exposes the package version", () => {
    expect(readVersion()).toBe("1.0.0");
  });

  it("registers the expected commands", () => {
    const program = createProgram();
    const names = program.commands.map((command) => command.name());
    expect(names).toEqual(expect.arrayContaining(["run", "models", "config", "doctor"]));
  });

  it("reads nested config values", () => {
    const config = { permissions: { default: "plan", rules: [] }, model: "a/b" };
    expect(getConfigValue(config, "permissions.default")).toBe("plan");
    expect(getConfigValue(config, "model")).toBe("a/b");
    expect(getConfigValue(config, "missing.path")).toBeUndefined();
  });
});
