import type { ToolDefinition } from "@harness/shared";
import { z } from "zod";
import {
  assertInsideWorkspace,
  assertRealInside,
  atomicWrite,
  diffText,
  fileExists,
  readTextFile,
  resolveWorkspacePath,
} from "./common";

const writeInput = z.object({
  path: z.string().min(1).describe("File path, relative to the workspace or absolute"),
  content: z.string().describe("Complete file contents"),
});

export type WriteInput = z.infer<typeof writeInput>;

export const writeTool: ToolDefinition<WriteInput> = {
  id: "write",
  description:
    "Create or overwrite a file with the exact contents provided. Writes atomically and returns a diff.",
  input: writeInput,
  readOnly: false,
  parallelizable: false,
  defaultDecision: "ask",
  timeoutMs: 30_000,
  async execute(input, context) {
    const fullPath = resolveWorkspacePath(context.cwd, input.path);
    assertInsideWorkspace(context.cwd, fullPath);
    await assertRealInside(context.cwd, fullPath);

    const existed = await fileExists(fullPath);
    let before = "";
    if (existed) {
      try {
        before = await readTextFile(fullPath);
      } catch {
        before = "";
      }
    }

    await context.checkpoint?.(fullPath);
    await atomicWrite(fullPath, input.content);
    const diff = diffText(input.path, before, input.content);

    return {
      kind: "diff",
      diff,
      files: [{ path: input.path, status: existed ? "modified" : "added" }],
    };
  },
};
