import type { ToolDefinition } from "@kiln/shared";
import { z } from "zod";
import {
  assertInsideWorkspace,
  assertRealInside,
  lineNumbered,
  readTextFile,
  resolveWorkspacePath,
  truncateText,
} from "./common";

const readInput = z.object({
  path: z.string().min(1).describe("File path, relative to the workspace or absolute"),
  offset: z.number().int().nonnegative().optional().describe("Zero-based line offset"),
  limit: z.number().int().positive().max(5_000).optional().describe("Maximum lines to read"),
});

export type ReadInput = z.infer<typeof readInput>;

export const readTool: ToolDefinition<ReadInput> = {
  id: "read",
  description:
    "Read a UTF-8 text file from the workspace. Returns numbered lines and truncates very large files.",
  input: readInput,
  readOnly: true,
  parallelizable: true,
  defaultDecision: "allow",
  async execute(input, context) {
    const fullPath = resolveWorkspacePath(context.cwd, input.path);
    assertInsideWorkspace(context.cwd, fullPath);
    await assertRealInside(context.cwd, fullPath);

    const content = await readTextFile(fullPath);
    const lines = content.split("\n");
    const offset = input.offset ?? 0;
    const limit = input.limit ?? 2_000;
    const selected = lines.slice(offset, offset + limit).join("\n");
    const numbered = lineNumbered(selected, offset + 1);
    const result = truncateText(numbered, 30_000);

    const notice =
      lines.length > offset + limit
        ? `\n\n[showing ${Math.min(limit, lines.length - offset)} of ${lines.length} lines]`
        : "";
    return { kind: "text", text: `${result.text}${notice}` };
  },
};
