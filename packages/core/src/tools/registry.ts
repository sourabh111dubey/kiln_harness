import {
  KilncraftError,
  type ToolContext,
  type ToolDefinition,
  type ToolOutput,
  type ToolSpec,
} from "@kilncraft/shared";
import { z } from "zod";
import { bashTool } from "./bash";
import { editTool } from "./edit";
import { globTool } from "./glob";
import { grepTool } from "./grep";
import { lsTool } from "./ls";
import { lspDiagnosticsTool, lspSymbolsTool } from "./lsp";
import { readTool } from "./read";
import { todoTool } from "./todo";
import { writeTool } from "./write";

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition<unknown>>();

  register<TInput>(tool: ToolDefinition<TInput>): void {
    this.tools.set(tool.id, tool as ToolDefinition<unknown>);
  }

  get(id: string): ToolDefinition<unknown> | undefined {
    return this.tools.get(id);
  }

  list(): ToolDefinition<unknown>[] {
    return [...this.tools.values()];
  }

  toSpecs(): ToolSpec[] {
    return this.list().map((tool) => ({
      name: tool.id,
      description: tool.description,
      parameters:
        tool.parametersOverride ?? (z.toJSONSchema(tool.input) as Record<string, unknown>),
    }));
  }

  async execute(id: string, input: unknown, context: ToolContext): Promise<ToolOutput> {
    const tool = this.tools.get(id);
    if (!tool) {
      throw new KilncraftError("tool_not_found", `Unknown tool: ${id}`, {
        details: { tool: id },
      });
    }

    if (
      typeof input === "object" &&
      input !== null &&
      !Array.isArray(input) &&
      typeof (input as Record<string, unknown>).__invalid_json === "string"
    ) {
      throw new KilncraftError(
        "tool_error",
        `Invalid JSON input for ${id}: ${String((input as Record<string, unknown>).__invalid_json).slice(0, 300)}`,
        { details: { tool: id } },
      );
    }

    const parsed = tool.input.safeParse(input);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
        .join("; ");
      throw new KilncraftError("tool_error", `Invalid input for ${id}: ${issues}`, {
        details: { tool: id, issues: parsed.error.issues },
      });
    }

    return tool.execute(parsed.data, context);
  }
}

export function createDefaultToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(readTool);
  registry.register(writeTool);
  registry.register(editTool);
  registry.register(globTool);
  registry.register(grepTool);
  registry.register(lsTool);
  registry.register(lspDiagnosticsTool);
  registry.register(lspSymbolsTool);
  registry.register(bashTool);
  registry.register(todoTool);
  return registry;
}
