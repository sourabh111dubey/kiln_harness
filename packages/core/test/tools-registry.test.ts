import type { ToolDefinition } from "@kilncraft/shared";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createDefaultToolRegistry, ToolRegistry } from "../src/tools/registry";
import { makeContext, makeTempDir, removeTempDir } from "./helpers";

const doubleTool: ToolDefinition<{ value: number }> = {
  id: "double",
  description: "Double a number",
  input: z.object({ value: z.number() }),
  readOnly: true,
  parallelizable: true,
  defaultDecision: "allow",
  async execute(input) {
    return { kind: "text", text: String(input.value * 2) };
  },
};

describe("tool registry", () => {
  it("registers, lists, and executes tools", async () => {
    const cwd = await makeTempDir("kilncraft-registry-");
    try {
      const registry = new ToolRegistry();
      registry.register(doubleTool);

      expect(registry.get("double")).toBe(doubleTool);
      expect(registry.list()).toHaveLength(1);
      expect(registry.toSpecs()[0]?.name).toBe("double");

      const output = await registry.execute("double", { value: 4 }, makeContext(cwd));
      expect(output).toEqual({ kind: "text", text: "8" });
    } finally {
      await removeTempDir(cwd);
    }
  });

  it("rejects unknown tools and invalid input", async () => {
    const cwd = await makeTempDir("kilncraft-registry-");
    try {
      const registry = new ToolRegistry();
      registry.register(doubleTool);

      await expect(registry.execute("missing", {}, makeContext(cwd))).rejects.toMatchObject({
        code: "tool_not_found",
      });
      await expect(
        registry.execute("double", { value: "nope" }, makeContext(cwd)),
      ).rejects.toMatchObject({ code: "tool_error" });
    } finally {
      await removeTempDir(cwd);
    }
  });

  it("creates the default tool set", () => {
    const registry = createDefaultToolRegistry();
    const ids = registry.list().map((tool) => tool.id);
    expect(ids).toEqual(
      expect.arrayContaining(["read", "write", "edit", "glob", "grep", "ls", "bash", "todo_write"]),
    );
    expect(registry.toSpecs().every((spec) => spec.parameters.type === "object")).toBe(true);
  });
});
