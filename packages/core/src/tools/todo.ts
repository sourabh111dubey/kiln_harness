import type { ToolDefinition } from "@harness/shared";
import { z } from "zod";

export const todoSchema = z.object({
  content: z.string().min(1),
  status: z.enum(["pending", "in_progress", "completed"]),
  activeForm: z.string().optional(),
});

export type Todo = z.infer<typeof todoSchema>;

const todoInput = z.object({
  todos: z.array(todoSchema).describe("Complete replacement for the current todo list"),
});

export type TodoInput = z.infer<typeof todoInput>;

export function formatTodos(todos: Todo[]): string {
  if (todos.length === 0) return "(no todos)";
  const marker = (status: Todo["status"]) =>
    status === "completed" ? "[x]" : status === "in_progress" ? "[~]" : "[ ]";
  return todos.map((todo) => `${marker(todo.status)} ${todo.content}`).join("\n");
}

export const todoTool: ToolDefinition<TodoInput> = {
  id: "todo_write",
  description:
    "Create or replace the visible task checklist. Use it for multi-step work; mark exactly one task in_progress.",
  input: todoInput,
  readOnly: true,
  parallelizable: false,
  defaultDecision: "allow",
  async execute(input, context) {
    context.state.todos = input.todos;
    return { kind: "text", text: formatTodos(input.todos) };
  },
};
