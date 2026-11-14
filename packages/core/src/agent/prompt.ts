import type { ToolDefinition } from "@kilncraft/shared";
import { z } from "zod";
import type { Todo } from "../tools/todo";

export interface PromptOptions {
  cwd: string;
  model: string;
  tools: ToolDefinition<unknown>[];
  todos: Todo[];
}

export function buildSystemPrompt(options: PromptOptions): string {
  const toolLines = options.tools
    .map((tool) => {
      const schema = JSON.stringify(z.toJSONSchema(tool.input));
      return `- ${tool.id}: ${tool.description}\n  input: ${schema}`;
    })
    .join("\n");

  const todoLines =
    options.todos.length > 0
      ? `\nCurrent todos:\n${options.todos
          .map((todo) => `- [${todo.status}] ${todo.content}`)
          .join("\n")}\n`
      : "";

  return `You are Kilncraft, an expert coding agent working in a local repository.

Environment:
- Working directory: ${options.cwd}
- Model: ${options.model}
- Date: ${new Date().toISOString()}

Available tools:
${toolLines}

Rules:
- Investigate before editing. Use read, glob, and grep to understand the code.
- Use edit for exact string replacements and write only for new files or full rewrites.
- Prefer small, verifiable changes. Run tests or builds when they exist.
- Use todo_write for multi-step work and keep it current.
- Never claim a change is complete without evidence.
- If a tool fails, read the error and adjust; do not repeat the same failing call.
- Do not expose secrets or credentials.
${todoLines}`;
}
