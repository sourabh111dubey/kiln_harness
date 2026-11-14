import { readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import type { ToolDefinition } from "@harness/shared";
import { z } from "zod";
import {
  assertInsideWorkspace,
  assertRealInside,
  isBinary,
  matchesGlob,
  resolveWorkspacePath,
  truncateText,
  walkFiles,
} from "./common";

const grepInput = z.object({
  pattern: z.string().min(1).describe("Regular expression to search for"),
  path: z
    .string()
    .optional()
    .describe("File or directory to search (defaults to the workspace root)"),
  glob: z.string().optional().describe("Only search files matching this glob"),
  caseSensitive: z.boolean().optional().describe("Case-sensitive matching (default false)"),
  context: z
    .number()
    .int()
    .min(0)
    .max(10)
    .optional()
    .describe("Lines of context around each match"),
  maxResults: z.number().int().positive().max(1_000).optional().describe("Maximum matches"),
});

export type GrepInput = z.infer<typeof grepInput>;

export const grepTool: ToolDefinition<GrepInput> = {
  id: "grep",
  description:
    "Search file contents with a regular expression. Returns file:line matches and optional context.",
  input: grepInput,
  readOnly: true,
  parallelizable: true,
  defaultDecision: "allow",
  async execute(input, context) {
    const root = resolveWorkspacePath(context.cwd, input.path ?? ".");
    assertInsideWorkspace(context.cwd, root);
    await assertRealInside(context.cwd, root);

    let expression: RegExp;
    try {
      expression = new RegExp(input.pattern, input.caseSensitive ? "" : "i");
    } catch (error) {
      return {
        kind: "text",
        text: `Invalid regular expression: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    const maxResults = input.maxResults ?? 100;
    const contextLines = input.context ?? 0;
    const matches: string[] = [];
    let total = 0;

    const targets: Array<{ full: string; relative: string }> = [];
    const rootInfo = await stat(root).catch(() => undefined);

    if (rootInfo?.isFile()) {
      const relative = input.path ?? basename(root);
      if (!input.glob || matchesGlob(relative, input.glob)) {
        targets.push({ full: root, relative });
      }
    } else {
      for await (const relativePath of walkFiles(root)) {
        if (input.glob && !matchesGlob(relativePath, input.glob)) continue;
        targets.push({ full: join(root, relativePath), relative: relativePath });
      }
    }

    for (const target of targets) {
      let content: string;
      try {
        const info = await stat(target.full);
        if (info.size > 2_000_000) continue;
        const buffer = await readFile(target.full);
        if (isBinary(buffer)) continue;
        content = buffer.toString("utf8");
      } catch {
        continue;
      }

      const lines = content.split("\n");
      for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        if (line === undefined || !expression.test(line)) continue;

        total++;
        if (matches.length >= maxResults) continue;

        const start = Math.max(0, index - contextLines);
        const end = Math.min(lines.length - 1, index + contextLines);
        for (let cursor = start; cursor <= end; cursor++) {
          const current = lines[cursor];
          if (current === undefined) continue;
          const marker = cursor === index ? ":" : "-";
          matches.push(`${target.relative}${marker}${cursor + 1}${marker}${current}`);
        }
        if (contextLines > 0) matches.push("--");
      }
    }

    if (total === 0) {
      return {
        kind: "text",
        text: `No matches found for /${input.pattern}/ in ${input.path ?? context.cwd}`,
      };
    }

    const body = matches.join("\n");
    const result = truncateText(body, 30_000);
    const notice =
      total > matches.length ? `\n\n[showing ${matches.length} of ${total} matches]` : "";
    return { kind: "text", text: `${result.text}${notice}` };
  },
};
