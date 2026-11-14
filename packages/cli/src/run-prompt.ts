import { join, resolve } from "node:path";
import {
  Agent,
  type AgentEvent,
  AuditLog,
  CheckpointManager,
  createDefaultProviderRegistry,
  createDefaultToolRegistry,
  PermissionEngine,
  type ProviderRegistry,
  resolveDataDir,
  SessionStore,
  type ToolRegistry,
} from "@kiln/core";
import { LspManager, type LspServerConfig } from "@kiln/lsp";
import { createSandbox } from "@kiln/sandbox";
import {
  createLogger,
  KilnError,
  loadConfig,
  type PermissionMode,
  parseModelRef,
  type Session,
} from "@kiln/shared";

type Logger = ReturnType<typeof createLogger>;

export interface RunPromptOptions {
  prompt: string;
  cwd?: string;
  model?: string;
  permissionMode?: PermissionMode;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  verbose?: boolean;
  registry?: ProviderRegistry;
  tools?: ToolRegistry;
  logger?: Logger;
  dataDir?: string;
  sessionID?: string;
  continueSession?: boolean;
  agent?: string;
  onEvent?: (event: AgentEvent) => void | Promise<void>;
}

export interface RunPromptResult {
  sessionID: string;
  model: string;
  permissionMode: PermissionMode;
  text: string;
  usage: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    reasoning?: number;
  };
  cost: number;
  toolCalls: number;
  stopReason: string;
}

export async function runPrompt(options: RunPromptOptions): Promise<RunPromptResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const env = options.env ?? process.env;
  const loaded = await loadConfig({ cwd, env });
  const dataDir = options.dataDir ? options.dataDir : resolveDataDir(env);
  const store = new SessionStore({ dataDir });
  const audit = new AuditLog(join(dataDir, "audit.jsonl"));
  const checkpoints = new CheckpointManager(dataDir);

  let session: Session | undefined;
  if (options.sessionID) {
    session = store.get(options.sessionID);
    if (!session) {
      throw new KilnError("session_not_found", `Session ${options.sessionID} was not found`, {
        details: { sessionID: options.sessionID },
      });
    }
  } else if (options.continueSession) {
    session = store.list({ cwd })[0];
  }

  const modelRef = options.model ?? session?.model ?? loaded.config.model ?? env.KILN_MODEL;
  if (!modelRef) {
    throw new KilnError(
      "invalid_argument",
      "No model configured. Set `model` in config, pass --model, or set KILN_MODEL.",
      { hint: "Example: --model anthropic/claude-sonnet-4-5" },
    );
  }

  const parsed = parseModelRef(modelRef);
  if (!parsed) {
    throw new KilnError(
      "invalid_argument",
      `Invalid model reference "${modelRef}". Expected provider/model.`,
      { hint: "Example: anthropic/claude-sonnet-4-5" },
    );
  }

  const registry = options.registry ?? createDefaultProviderRegistry(env);
  const provider = registry.get(parsed.provider);
  if (!provider) {
    throw new KilnError("provider_error", `Provider "${parsed.provider}" is not configured.`, {
      hint: `Available providers: ${registry
        .list()
        .map((entry) => entry.id)
        .join(", ")}`,
    });
  }

  const sessionCwd = session?.cwd ?? cwd;
  const permissionMode =
    options.permissionMode ?? session?.permissions ?? loaded.config.permissions.default;
  const permissions = new PermissionEngine({
    mode: permissionMode,
    cwd: sessionCwd,
    rules: loaded.config.permissions.rules,
  });

  const logger =
    options.logger ??
    createLogger({
      level: options.verbose ? "debug" : (env.KILN_LOG_LEVEL ?? "info"),
    });

  const agent = new Agent({
    cwd: sessionCwd,
    provider,
    model: parsed.model,
    tools: options.tools ?? createDefaultToolRegistry(),
    permissions,
    logger,
    agent: options.agent ?? loaded.config.agent,
    store,
    session,
    audit,
    checkpoints,
    sandbox: loaded.config.sandbox.enabled
      ? createSandbox({ workspace: sessionCwd, network: loaded.config.sandbox.network })
      : undefined,
    lsp: new LspManager(loaded.config.lsp.servers as Record<string, LspServerConfig>, sessionCwd),
  });

  const result = await agent.prompt(options.prompt, {
    onEvent: options.onEvent,
    signal: options.signal,
  });

  return {
    sessionID: result.sessionID,
    model: modelRef,
    permissionMode,
    text: result.text,
    usage: result.usage,
    cost: result.cost,
    toolCalls: result.toolCalls,
    stopReason: result.stopReason,
  };
}
