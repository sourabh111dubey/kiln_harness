import type { ToolDefinition } from "@harness/shared";
import { z } from "zod";
import {
  assertInsideWorkspace,
  atomicWrite,
  diffText,
  readTextFile,
  resolveWorkspacePath,
} from "./common";

const editInput = z.object({
  path: z.string().min(1).describe("File path, relative to the workspace or absolute"),
  oldString: z.string().min(1).describe("Exact text to replace"),
  newString: z.string().describe("Replacement text"),
  replaceAll: z
    .boolean()
    .optional()
    .describe("Replace every occurrence instead of requiring uniqueness"),
});

export type EditInput = z.infer<typeof editInput>;

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count++;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

export const editTool: ToolDefinition<EditInput> = {
  id: "edit",
  description:
    "Replace an exact string in a file. The match must be unique unless replaceAll is true. Returns a diff.",
  input: editInput,
  readOnly: false,
  parallelizable: false,
  defaultDecision: "ask",
  timeoutMs: 30_000,
  async execute(input, context) {
    const fullPath = resolveWorkspacePath(context.cwd, input.path);
    assertInsideWorkspace(context.cwd, fullPath);

    const original = await readTextFile(fullPath);
    let content = original;
    let occurrences = countOccurrences(content, input.oldString);

    if (occurrences === 0 && input.oldString.includes("\r\n")) {
      content = content.replace(/\r\n/g, "\n");
      occurrences = countOccurrences(content, input.oldString);
    } else if (occurrences === 0 && content.includes("\r\n")) {
      const normalizedOld = input.oldString.replace(/\r\n/g, "\n");
      const normalizedCount = countOccurrences(content.replace(/\r\n/g, "\n"), normalizedOld);
      if (normalizedCount > 0) {
        content = content.replace(/\r\n/g, "\n");
        occurrences = normalizedCount;
      }
    }

    if (occurrences === 0) {
      return {
        kind: "text",
        text: `Could not find the exact text to replace in ${input.path}. Read the file first and copy the exact string.`,
      };
    }

    if (occurrences > 1 && !input.replaceAll) {
      return {
        kind: "text",
        text: `Found ${occurrences} occurrences of the text in ${input.path}. Provide more surrounding context or set replaceAll.`,
      };
    }

    const updated = input.replaceAll
      ? content.split(input.oldString).join(input.newString)
      : content.replace(input.oldString, input.newString);

    await context.checkpoint?.(fullPath);
    await atomicWrite(fullPath, updated);
    const diff = diffText(input.path, original, updated);
    return {
      kind: "diff",
      diff,
      files: [{ path: input.path, status: "modified" }],
    };
  },
};
