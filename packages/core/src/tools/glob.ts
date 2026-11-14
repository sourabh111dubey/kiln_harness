import { isAbsolute, resolve } from "node:path";
import type { ToolDefinition } from "@harness/shared";
import { glob } from "tinyglobby";
import { z } from "zod";
import {
  assertInsideWorkspace,
  assertRealInside,
  GLOB_IGNORE,
  resolveWorkspacePath,
  truncateText,
} from "./common";

const globInput = z.object({
  pattern: z.string().min(1).describe("Glob pattern, for example src/**/*.ts"),
  path: z.string().optional().describe("Directory to search in (defaults to the workspace root)"),
});

export type GlobInput = z.infer<typeof globInput>;

export const globTool: ToolDefinition<GlobInput> = {
  id: "glob",
  description:
    "Find files by glob pattern. Ignores node_modules, .git, build output, and other noise.",
  input: globInput,
  readOnly: true,
  parallelizable: true,
  defaultDecision: "allow",
  async execute(input, context) {
    const root = input.path ? resolveWorkspacePath(context.cwd, input.path) : context.cwd;
    assertInsideWorkspace(context.cwd, root);
    await assertRealInside(context.cwd, root);

    if (isAbsolute(input.pattern) || input.pattern.split(/[\\/]/).includes("..")) {
      return {
        kind: "text",
        text: "Glob pattern must be relative and cannot contain '..' segments.",
      };
    }

    const files = await glob(input.pattern, {
      cwd: root,
      ignore: GLOB_IGNORE,
      dot: false,
      onlyFiles: true,
      followSymbolicLinks: false,
    });

    const safeFiles: string[] = [];
    for (const file of files) {
      const fullPath = resolve(root, file);
      try {
        await assertRealInside(root, fullPath);
        safeFiles.push(file);
      } catch {
        // Ignore symlinks that escape the workspace.
      }
    }

    const sorted = safeFiles.sort((left, right) => left.localeCompare(right));
    const limited = sorted.slice(0, 200);
    const result = truncateText(limited.join("\n"), 30_000);
    const notice =
      sorted.length > limited.length
        ? `\n\n[showing ${limited.length} of ${sorted.length} files]`
        : "";
    return { kind: "text", text: result.text ? `${result.text}${notice}` : "(no files found)" };
  },
};
