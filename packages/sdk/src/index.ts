import { join, resolve } from "node:path";
import {
  Agent,
  type AgentEvent,
  AuditLog,
  CheckpointManager,
  createDefaultProviderRegistry,
  createDefaultToolRegistry,
  loadPlugins,
  type PermissionAskRequest,
  PermissionEngine,
  type PluginHost,
  type ProviderRegistry,
  SessionStore,
  type ToolRegistry,
  type TurnResult,
} from "@kiln/core";
import { LspManager, type LspServerConfig } from "@kiln/lsp";
import { createSandbox } from "@kiln/sandbox";
import {
  createLogger,
  type KilnConfig,
  KilnError,
  loadConfig,
  type PermissionDecision,
  type PermissionMode,
  parseModelRef,
  type Session,
} from "@kiln/shared";

type Logger = ReturnType<typeof createLogger>;

export interface KilnOptions {
  cwd?: string;
  model?: string;
  dataDir?: string;
  env?: NodeJS.ProcessEnv;
  registry?: ProviderRegistry;
  tools?: ToolRegistry;
  permissionMode?: PermissionMode;
  logger?: Logger;
  askPermission?: (request: PermissionAskRequest, requestID: string) => Promise<PermissionDecision>;
}

export interface CreateSessionInput {
  cwd?: string;
  model?: string;
  agent?: string;
  title?: string;
  permissionMode?: PermissionMode;
  metadata?: Record<string, unknown>;
}

export interface PromptOptions {
  onEvent?: (event: AgentEvent) => void | Promise<void>;
  signal?: AbortSignal;
  model?: string;
  permissionMode?: PermissionMode;
}

export class Kiln {
  readonly store: SessionStore;
  private readonly registry: ProviderRegistry;
  private tools: ToolRegistry;
  private readonly env: NodeJS.ProcessEnv;
  private readonly cwd: string;
  private readonly logger: Logger;
  private readonly audit: AuditLog;
  private readonly checkpoints: CheckpointManager;
  private readonly agents = new Map<string, Agent>();
  private readonly running = new Set<string>();
  private readonly lspManagers = new Set<LspManager>();
  private configPromise: Promise<KilnConfig>;
  private pluginsPromise: Promise<PluginHost | undefined>;

  constructor(private readonly options: KilnOptions = {}) {
    this.env = options.env ?? process.env;
    this.cwd = resolve(options.cwd ?? process.cwd());
    this.store = new SessionStore({ dataDir: options.dataDir });
    this.registry = options.registry ?? createDefaultProviderRegistry(this.env);
    this.tools = options.tools ?? createDefaultToolRegistry();
    this.logger = options.logger ?? createLogger({ level: this.env.KILN_LOG_LEVEL ?? "info" });
    this.audit = new AuditLog(join(this.store.dataDir, "audit.jsonl"));
    this.checkpoints = new CheckpointManager(this.store.dataDir);
    this.configPromise = loadConfig({ cwd: this.cwd, env: this.env }).then(
      (loaded) => loaded.config,
    );
    this.pluginsPromise = this.configPromise
      .then((config) =>
        loadPlugins(config.plugins, {
          cwd: this.cwd,
          dataDir: this.store.dataDir,
          logger: this.logger,
        }),
      )
      .catch((error: unknown) => {
        this.logger.warn({ err: error }, "failed to load plugins");
        return undefined;
      });
  }

  async createSession(input: CreateSessionInput = {}): Promise<Session> {
    const config = await this.configPromise;
    const model = input.model ?? this.options.model ?? this.env.KILN_MODEL ?? config.model;
    if (!model) {
      throw new KilnError(
        "invalid_argument",
        "No model configured. Pass model or set it in config.",
        { hint: "Example: anthropic/claude-sonnet-4-5" },
      );
    }

    return this.store.create({
      cwd: input.cwd ?? this.cwd,
      model,
      agent: input.agent ?? config.agent,
      title: input.title,
      permissions:
        input.permissionMode ?? this.options.permissionMode ?? config.permissions.default,
      metadata: input.metadata,
    });
  }

  async prompt(
    sessionID: string,
    prompt: string,
    options: PromptOptions = {},
  ): Promise<TurnResult> {
    const session = this.store.get(sessionID);
    if (!session) {
      throw new KilnError("session_not_found", `Session ${sessionID} was not found`, {
        details: { sessionID },
      });
    }

    if (this.running.has(sessionID)) {
      throw new KilnError("invalid_argument", `Session ${sessionID} is already running`);
    }
    this.running.add(sessionID);

    const agent = await this.getAgent(session, options.model, options.permissionMode);
    try {
      return await agent.prompt(prompt, {
        onEvent: options.onEvent,
        signal: options.signal,
      });
    } finally {
      this.running.delete(sessionID);
    }
  }

  listSessions(filter: { cwd?: string; limit?: number } = {}): Session[] {
    return this.store.list(filter);
  }

  getSession(sessionID: string): Session | undefined {
    return this.store.get(sessionID);
  }

  deleteSession(sessionID: string): boolean {
    return this.store.delete(sessionID);
  }

  exportSession(sessionID: string, format: "json" | "md" = "json"): string {
    return this.store.export(sessionID, format);
  }

  async compact(sessionID: string): Promise<ReturnType<typeof Agent.prototype.compact>> {
    const session = this.store.get(sessionID);
    if (!session) throw new KilnError("session_not_found", `Session ${sessionID} was not found`);
    const agent = await this.getAgent(session);
    return agent.compact();
  }

  close(): void {
    for (const lsp of this.lspManagers) void lsp.close().catch(() => undefined);
    this.lspManagers.clear();
    this.agents.clear();
    this.running.clear();
    this.store.close();
  }

  async reload(): Promise<string[]> {
    const loaded = await loadConfig({ cwd: this.cwd, env: this.env });
    this.configPromise = Promise.resolve(loaded.config);
    this.agents.clear();
    this.running.clear();
    for (const lsp of this.lspManagers) void lsp.close().catch(() => undefined);
    this.lspManagers.clear();
    this.tools = createDefaultToolRegistry();

    const plugins = await loadPlugins(loaded.config.plugins, {
      cwd: this.cwd,
      dataDir: this.store.dataDir,
      logger: this.logger,
    }).catch((error: unknown) => {
      this.logger.warn({ err: error }, "failed to reload plugins");
      return undefined;
    });

    this.pluginsPromise = Promise.resolve(plugins);
    return plugins?.plugins.map((plugin) => plugin.id) ?? [];
  }

  private async getAgent(
    session: Session,
    modelOverride?: string,
    permissionMode?: PermissionMode,
  ): Promise<Agent> {
    const config = await this.configPromise;
    const modelRef = modelOverride ?? session.model;
    if (!modelRef) {
      throw new KilnError("invalid_argument", "Session has no model");
    }

    const parsed = parseModelRef(modelRef);
    if (!parsed) {
      throw new KilnError("invalid_argument", `Invalid model reference "${modelRef}"`);
    }

    const provider = this.registry.get(parsed.provider);
    if (!provider) {
      throw new KilnError("provider_error", `Provider "${parsed.provider}" is not configured`, {
        hint: `Available: ${this.registry
          .list()
          .map((entry) => entry.id)
          .join(", ")}`,
      });
    }

    const mode = permissionMode ?? session.permissions ?? config.permissions.default;
    const key = `${session.id}:${modelRef}:${mode}`;
    const existing = this.agents.get(key);
    if (existing) {
      existing.replaceMessages(this.store.readMessages(session.id));
      return existing;
    }

    const plugins = await this.pluginsPromise;
    if (plugins) {
      for (const tool of plugins.getTools()) this.tools.register(tool);
    }

    const permissions = new PermissionEngine({
      mode,
      cwd: session.cwd,
      rules: config.permissions.rules,
    });

    const askPermission =
      this.options.askPermission ??
      (async () => {
        return "deny" as PermissionDecision;
      });

    const lsp = new LspManager(config.lsp.servers as Record<string, LspServerConfig>, session.cwd);
    this.lspManagers.add(lsp);

    const agent = new Agent({
      cwd: session.cwd,
      provider,
      model: parsed.model,
      tools: this.tools,
      permissions,
      logger: this.logger,
      agent: session.agent,
      store: this.store,
      session,
      audit: this.audit,
      checkpoints: this.checkpoints,
      askPermission,
      plugins,
      sandbox: config.sandbox.enabled
        ? createSandbox({ workspace: session.cwd, network: config.sandbox.network })
        : undefined,
      lsp,
    });

    this.agents.set(key, agent);
    return agent;
  }
}

export function createKiln(options: KilnOptions = {}): Kiln {
  return new Kiln(options);
}

export type { AgentEvent, TurnResult };
