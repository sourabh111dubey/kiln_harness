import type { Logger } from "pino";
import type { z } from "zod";
import type { LspManagerLike } from "./lsp";
import type { PermissionDecision } from "./permission";
import type { SandboxAdapter } from "./sandbox";
import type { ToolOutput } from "./schemas";

export interface ToolContext {
  sessionID: string;
  cwd: string;
  workspaceRoot: string;
  signal: AbortSignal;
  logger: Logger;
  state: Record<string, unknown>;
  checkpoint?: (path: string) => void | Promise<void>;
  sandbox?: SandboxAdapter;
  lsp?: LspManagerLike;
}

export interface ToolDefinition<TInput = unknown> {
  id: string;
  description: string;
  input: z.ZodType<TInput>;
  readOnly: boolean;
  parallelizable: boolean;
  defaultDecision: PermissionDecision;
  timeoutMs?: number;
  parametersOverride?: Record<string, unknown>;
  execute(input: TInput, context: ToolContext): Promise<ToolOutput>;
}

export type ToolResult = ToolOutput;
