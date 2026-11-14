import type { ToolDefinition } from "@kilncraft/shared";
import { z } from "zod";
import { assertInsideWorkspace, assertRealInside, resolveWorkspacePath } from "./common";

const pathInput = z.object({
  path: z.string().min(1).describe("File path, relative to the workspace or absolute"),
});

function formatDiagnostics(
  path: string,
  diagnostics: Array<{
    message: string;
    severity?: number;
    range: { start: { line: number; character: number } };
  }>,
): string {
  if (diagnostics.length === 0) return `No diagnostics for ${path}.`;
  const severity = (value?: number) =>
    value === 1 ? "error" : value === 2 ? "warning" : value === 3 ? "info" : "hint";
  return diagnostics
    .map((diagnostic) => {
      const line = diagnostic.range.start.line + 1;
      const character = diagnostic.range.start.character + 1;
      return `${path}:${line}:${character} ${severity(diagnostic.severity)} ${diagnostic.message}`;
    })
    .join("\n");
}

export const lspDiagnosticsTool: ToolDefinition<z.infer<typeof pathInput>> = {
  id: "lsp_diagnostics",
  description:
    "Return language-server diagnostics for a file. Requires an LSP server for the file type.",
  input: pathInput,
  readOnly: true,
  parallelizable: false,
  defaultDecision: "allow",
  timeoutMs: 30_000,
  async execute(input, context) {
    if (!context.lsp) {
      return { kind: "text", text: "LSP is not configured for this session." };
    }
    const fullPath = resolveWorkspacePath(context.cwd, input.path);
    assertInsideWorkspace(context.cwd, fullPath);
    await assertRealInside(context.cwd, fullPath);
    try {
      const diagnostics = await context.lsp.diagnosticsFor(fullPath);
      return { kind: "text", text: formatDiagnostics(input.path, diagnostics) };
    } catch (error) {
      return {
        kind: "text",
        text: `LSP diagnostics failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
};

export const lspSymbolsTool: ToolDefinition<z.infer<typeof pathInput>> = {
  id: "lsp_symbols",
  description: "Return document symbols (outline) for a file from the language server.",
  input: pathInput,
  readOnly: true,
  parallelizable: false,
  defaultDecision: "allow",
  timeoutMs: 30_000,
  async execute(input, context) {
    if (!context.lsp) {
      return { kind: "text", text: "LSP is not configured for this session." };
    }
    const fullPath = resolveWorkspacePath(context.cwd, input.path);
    assertInsideWorkspace(context.cwd, fullPath);
    await assertRealInside(context.cwd, fullPath);
    try {
      const symbols = await context.lsp.symbolsFor(fullPath);
      if (symbols.length === 0) return { kind: "text", text: `No symbols for ${input.path}.` };
      return {
        kind: "text",
        text: symbols.map((symbol) => `${symbol.name} (${symbol.kind ?? "symbol"})`).join("\n"),
      };
    } catch (error) {
      return {
        kind: "text",
        text: `LSP symbols failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
};
