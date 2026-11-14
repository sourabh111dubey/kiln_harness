import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { ToolDefinition } from "@harness/shared";
import { z } from "zod";
import {
  assertInsideWorkspace,
  DEFAULT_IGNORE,
  resolveWorkspacePath,
  truncateText,
} from "./common";

const lsInput = z.object({
  path: z.string().optional().describe("Directory to list (defaults to the workspace root)"),
  depth: z.number().int().min(1).max(5).optional().describe("Maximum directory depth (default 2)"),
});

export type LsInput = z.infer<typeof lsInput>;

async function listDirectory(
  root: string,
  directory: string,
  prefix: string,
  remainingDepth: number,
  output: string[],
): Promise<void> {
  if (output.length >= 500) return;

  let entries: Dirent[];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }

  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    if (DEFAULT_IGNORE.has(entry.name)) continue;
    if (output.length >= 500) return;

    if (entry.isDirectory()) {
      output.push(`${prefix}${entry.name}/`);
      if (remainingDepth > 1) {
        await listDirectory(
          root,
          join(directory, entry.name),
          `${prefix}  `,
          remainingDepth - 1,
          output,
        );
      }
    } else if (entry.isFile()) {
      output.push(`${prefix}${entry.name}`);
    }
  }
}

export const lsTool: ToolDefinition<LsInput> = {
  id: "ls",
  description: "List files and directories in the workspace as an indented tree.",
  input: lsInput,
  readOnly: true,
  parallelizable: true,
  defaultDecision: "allow",
  async execute(input, context) {
    const root = input.path ? resolveWorkspacePath(context.cwd, input.path) : context.cwd;
    assertInsideWorkspace(context.cwd, root);

    const output: string[] = [];
    await listDirectory(root, root, "", (input.depth ?? 2) + 1, output);

    if (output.length === 0) {
      return { kind: "text", text: "(empty directory)" };
    }

    const body = output.join("\n");
    const result = truncateText(body, 30_000);
    const notice = output.length >= 500 ? `\n\n[showing first 500 entries]` : "";
    return { kind: "text", text: `${result.text}${notice}` };
  },
};
