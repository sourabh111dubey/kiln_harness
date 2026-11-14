import { join, resolve } from "node:path";
import {
  Agent,
  AuditLog,
  CheckpointManager,
  compactMessages,
  createDefaultProviderRegistry,
  createDefaultToolRegistry,
  listKnownModels,
  loadPlugins,
  modelInfoFor,
  type PermissionAskRequest,
  PermissionEngine,
  type PluginHost,
  type ProviderRegistry,
  SessionStore,
} from "@harness/core";
import { LspManager, type LspServerConfig } from "@harness/lsp";
import { createMcpHttpHandler, type McpConnection, registerMcpTools } from "@harness/mcp";
import { createSandbox } from "@harness/sandbox";
import {
  createLogger,
  type HarnessConfig,
  HarnessError,
  loadConfig,
  type PermissionDecision,
  type PermissionMode,
  parseModelRef,
  type Session,
} from "@harness/shared";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { attachWebSocket } from "./ws";

export interface ServerOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  dataDir?: string;
  registry?: ProviderRegistry;
  tools?: ReturnType<typeof createDefaultToolRegistry>;
  logger?: ReturnType<typeof createLogger>;
}

interface PendingPermission {
  request: PermissionAskRequest;
  resolve: (decision: PermissionDecision) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface ServerContext {
  store: SessionStore;
  registry: ProviderRegistry;
  tools: ReturnType<typeof createDefaultToolRegistry>;
  agents: Map<string, Agent>;
  aborts: Map<string, AbortController>;
  pending: Map<string, PendingPermission>;
}

const PERMISSION_MODES: PermissionMode[] = [
  "default",
  "acceptEdits",
  "plan",
  "bypassPermissions",
  "custom",
];

function jsonError(message: string, status = 400): Response {
  return Response.json({ error: message }, { status });
}

function parsePermissionMode(value: unknown): PermissionMode | undefined {
  return typeof value === "string" && PERMISSION_MODES.includes(value as PermissionMode)
    ? (value as PermissionMode)
    : undefined;
}

const WEB_INDEX = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>harness</title>
  <style>
    body { background: #0b0e14; color: #d7dde8; font: 14px/1.5 ui-monospace, monospace; margin: 0; padding: 24px; }
    h1 { color: #67e8f9; font-size: 20px; }
    a { color: #67e8f9; }
    pre { white-space: pre-wrap; }
    .row { display: flex; gap: 8px; margin: 16px 0; }
    input { flex: 1; background: #111722; border: 1px solid #2b3545; color: inherit; padding: 8px; border-radius: 6px; }
    button { background: #164e63; color: #e0f2fe; border: 0; padding: 8px 14px; border-radius: 6px; cursor: pointer; }
  </style>
</head>
<body>
  <h1>harness</h1>
  <p>Local coding agent API. <a href="/openapi.json">OpenAPI</a> · <a href="/docs">Docs</a></p>
  <div class="row"><input id="prompt" placeholder="Ask the agent..." /><button id="send">Run</button></div>
  <pre id="out">Loading sessions...</pre>
  <script>
    const out = document.getElementById('out');
    fetch('/sessions').then(r => r.json()).then(data => {
      out.textContent = data.length ? data.map(s => s.id + '  ' + s.status + '  ' + s.cwd).join('\\n') : '(no sessions)';
    }).catch(error => { out.textContent = String(error); });
    document.getElementById('send').onclick = async () => {
      const prompt = document.getElementById('prompt').value;
      if (!prompt) return;
      const session = await fetch('/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cwd: '/' }) }).then(r => r.json());
      out.textContent = 'session ' + session.id + '\\n';
      const response = await fetch('/sessions/' + session.id + '/prompt', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt }) });
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split('\\n\\n');
        buffer = frames.pop() || '';
        for (const frame of frames) {
          const line = frame.split('\\n').find(l => l.startsWith('data:'));
          if (!line) continue;
          try { out.textContent += JSON.stringify(JSON.parse(line.slice(5))) + '\\n'; } catch {}
        }
      }
    };
  </script>
</body>
</html>`;

const OPENAPI = {
  openapi: "3.1.0",
  info: { title: "Harness API", version: "0.0.0" },
  paths: {
    "/health": { get: { summary: "Health check", responses: { "200": { description: "OK" } } } },
    "/info": {
      get: { summary: "Server information", responses: { "200": { description: "OK" } } },
    },
    "/models": {
      get: { summary: "List known models", responses: { "200": { description: "OK" } } },
    },
    "/tools": {
      get: { summary: "List registered tools", responses: { "200": { description: "OK" } } },
    },
    "/sessions": {
      get: { summary: "List sessions", responses: { "200": { description: "OK" } } },
      post: { summary: "Create a session", responses: { "200": { description: "OK" } } },
    },
    "/sessions/{id}": {
      get: { summary: "Get a session", responses: { "200": { description: "OK" } } },
      delete: { summary: "Delete a session", responses: { "200": { description: "OK" } } },
    },
    "/sessions/{id}/prompt": {
      post: {
        summary: "Stream a prompt as SSE",
        responses: { "200": { description: "SSE stream" } },
      },
    },
    "/sessions/{id}/abort": {
      post: { summary: "Abort the active turn", responses: { "200": { description: "OK" } } },
    },
    "/sessions/{id}/compact": {
      post: { summary: "Compact the session context", responses: { "200": { description: "OK" } } },
    },
    "/sessions/{id}/events": {
      get: {
        summary: "Replay session events as SSE",
        responses: { "200": { description: "SSE stream" } },
      },
    },
    "/sessions/{id}/messages": {
      get: { summary: "List session messages", responses: { "200": { description: "OK" } } },
    },
    "/mcp/servers": {
      get: {
        summary: "List configured and connected MCP servers",
        responses: { "200": { description: "OK" } },
      },
    },
    "/mcp": {
      post: {
        summary: "MCP Streamable HTTP endpoint",
        responses: { "200": { description: "MCP response" } },
      },
    },
    "/sessions/{id}/permissions/{requestID}": {
      post: {
        summary: "Resolve a pending permission request",
        responses: { "200": { description: "OK" } },
      },
    },
  },
};

export async function createHarnessApp(options: ServerOptions = {}): Promise<{
  app: Hono;
  context: ServerContext;
  config: HarnessConfig;
  close: () => void;
}> {
  const env = options.env ?? process.env;
  const cwd = resolve(options.cwd ?? process.cwd());
  const logger = options.logger ?? createLogger({ level: env.HARNESS_LOG_LEVEL ?? "info" });
  const loaded = await loadConfig({ cwd, env });
  const store = new SessionStore({ dataDir: options.dataDir });
  const registry = options.registry ?? createDefaultProviderRegistry(env);
  const tools = options.tools ?? createDefaultToolRegistry();
  const audit = new AuditLog(join(store.dataDir, "audit.jsonl"));
  const checkpoints = new CheckpointManager(store.dataDir);

  let plugins: PluginHost | undefined;
  try {
    plugins = await loadPlugins(loaded.config.plugins, {
      cwd,
      dataDir: store.dataDir,
      logger,
    });
    for (const tool of plugins.getTools()) tools.register(tool);
  } catch (error) {
    logger.warn({ err: error }, "failed to load plugins");
  }

  const mcpConnections: McpConnection[] = await registerMcpTools(tools, loaded.config.mcp.servers, {
    logger,
  });
  const mcpHttpHandler = await createMcpHttpHandler(tools.list());
  const context: ServerContext = {
    store,
    registry,
    tools,
    agents: new Map(),
    aborts: new Map(),
    pending: new Map(),
  };

  const defaultModel = env.HARNESS_MODEL ?? loaded.config.model;
  const defaultPermission = loaded.config.permissions.default;

  const denyPending = (sessionID: string): void => {
    for (const [requestID, entry] of context.pending) {
      if (entry.request.sessionID !== sessionID) continue;
      clearTimeout(entry.timer);
      entry.resolve("deny");
      context.pending.delete(requestID);
    }
  };

  const waitForPermission = (request: PermissionAskRequest): Promise<PermissionDecision> => {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        context.pending.delete(request.id);
        resolve("deny");
      }, 5 * 60_000);
      context.pending.set(request.id, { request, resolve, timer });
    });
  };

  const resolvePermission = (requestID: string, decision: PermissionDecision): boolean => {
    const entry = context.pending.get(requestID);
    if (!entry) return false;
    clearTimeout(entry.timer);
    context.pending.delete(requestID);
    entry.resolve(decision);
    return true;
  };

  const getAgent = (
    session: Session,
    modelOverride?: string,
    permissionMode?: PermissionMode,
  ): Agent => {
    const modelRef = modelOverride ?? session.model ?? defaultModel;
    if (!modelRef) {
      throw new HarnessError("invalid_argument", "No model configured for this session", {
        hint: "Pass model in the prompt body or set model in config.",
      });
    }

    const parsed = parseModelRef(modelRef);
    if (!parsed) {
      throw new HarnessError("invalid_argument", `Invalid model reference "${modelRef}"`);
    }

    const provider = registry.get(parsed.provider);
    if (!provider) {
      throw new HarnessError("provider_error", `Provider "${parsed.provider}" is not configured`, {
        hint: `Available: ${registry
          .list()
          .map((entry) => entry.id)
          .join(", ")}`,
      });
    }

    const mode = permissionMode ?? session.permissions ?? defaultPermission;
    const key = `${session.id}:${modelRef}:${mode}`;
    const existing = context.agents.get(key);
    if (existing) {
      existing.replaceMessages(store.readMessages(session.id));
      return existing;
    }

    const permissions = new PermissionEngine({
      mode,
      cwd: session.cwd,
      rules: loaded.config.permissions.rules,
      isReadOnly: (tool) => tools.get(tool)?.readOnly ?? false,
    });

    const sandbox = loaded.config.sandbox.enabled
      ? createSandbox({ workspace: session.cwd, network: loaded.config.sandbox.network })
      : undefined;
    const lsp = new LspManager(
      loaded.config.lsp.servers as Record<string, LspServerConfig>,
      session.cwd,
    );

    const agent = new Agent({
      cwd: session.cwd,
      provider,
      model: parsed.model,
      tools,
      permissions,
      logger,
      agent: session.agent,
      store,
      session,
      audit,
      checkpoints,
      askPermission: (request) => waitForPermission(request),
      plugins,
      sandbox,
      lsp,
    });

    context.agents.set(key, agent);
    return agent;
  };

  const app = new Hono();

  app.use(
    "*",
    cors({
      origin: env.HARNESS_CORS_ORIGIN ?? "*",
      allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
      allowHeaders: ["content-type", "authorization"],
    }),
  );

  const token = env.HARNESS_TOKEN;
  if (token) {
    app.use("*", async (c, next) => {
      if (c.req.path === "/health") return next();
      const header = c.req.header("authorization");
      if (header !== `Bearer ${token}`) return c.json({ error: "unauthorized" }, 401);
      await next();
    });
  }

  app.get("/", (c) => c.html(WEB_INDEX));
  app.get("/health", (c) => c.json({ ok: true, uptime: process.uptime() }));
  app.get("/info", (c) =>
    c.json({
      name: "harness",
      version: "0.0.0",
      node: process.version,
      platform: process.platform,
      dataDir: store.dataDir,
      providers: registry.list().map((provider) => provider.id),
      mcpServers: {
        configured: Object.keys(loaded.config.mcp.servers),
        connected: mcpConnections.map((connection) => connection.name),
      },
    }),
  );
  app.get("/openapi.json", (c) => c.json(OPENAPI));
  app.get("/docs", (c) =>
    c.html(
      `<!doctype html><meta charset="utf-8"><title>harness API</title><body style="font-family:monospace;background:#0b0e14;color:#d7dde8"><h1>harness API</h1><p><a href="/openapi.json" style="color:#67e8f9">/openapi.json</a></p><pre>${JSON.stringify(OPENAPI, null, 2).replace(/</g, "&lt;")}</pre></body>`,
    ),
  );

  app.get("/models", (c) =>
    c.json({
      known: listKnownModels(),
      configured: registry.list().map((provider) => provider.id),
    }),
  );

  app.get("/tools", (c) => c.json(tools.toSpecs()));

  app.get("/mcp/servers", (c) =>
    c.json({
      configured: Object.keys(loaded.config.mcp.servers),
      connected: mcpConnections.map((connection) => connection.name),
    }),
  );

  app.all("/mcp", (c) => mcpHttpHandler(c.req.raw));

  app.get("/sessions", (c) => {
    const cwdFilter = c.req.query("cwd");
    return c.json(store.list(cwdFilter ? { cwd: cwdFilter } : {}));
  });

  app.post("/sessions", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const sessionCwd =
      typeof body.cwd === "string" && body.cwd.length > 0 ? resolve(body.cwd) : cwd;
    const model = typeof body.model === "string" ? body.model : defaultModel;
    if (!model) return jsonError("model is required");
    const session = store.create({
      cwd: sessionCwd,
      model,
      agent: typeof body.agent === "string" ? body.agent : loaded.config.agent,
      title: typeof body.title === "string" ? body.title : undefined,
      permissions: parsePermissionMode(body.permissionMode) ?? loaded.config.permissions.default,
    });
    return c.json(session, 201);
  });

  app.get("/sessions/:id", (c) => {
    const session = store.get(c.req.param("id"));
    if (!session) return jsonError("session not found", 404);
    return c.json({ session, messages: store.readMessages(session.id) });
  });

  app.delete("/sessions/:id", (c) => {
    const id = c.req.param("id");
    context.aborts.get(id)?.abort();
    denyPending(id);
    for (const key of [...context.agents.keys()]) {
      if (key.startsWith(`${id}:`)) context.agents.delete(key);
    }
    const deleted = store.delete(id);
    return deleted ? c.json({ deleted: true }) : jsonError("session not found", 404);
  });

  app.get("/sessions/:id/messages", (c) => {
    const session = store.get(c.req.param("id"));
    if (!session) return jsonError("session not found", 404);
    return c.json(store.readMessages(session.id));
  });

  app.get("/sessions/:id/events", (c) => {
    const session = store.get(c.req.param("id"));
    if (!session) return jsonError("session not found", 404);
    return streamSSE(c, async (stream) => {
      for (const event of store.readEvents(session.id)) {
        await stream.writeSSE({ data: JSON.stringify({ event }) });
      }
    });
  });

  app.post("/sessions/:id/abort", (c) => {
    const sessionID = c.req.param("id");
    const controller = context.aborts.get(sessionID);
    if (controller) controller.abort();
    denyPending(sessionID);
    context.aborts.delete(sessionID);
    return c.json({ aborted: controller !== undefined });
  });

  app.post("/sessions/:id/compact", (c) => {
    const session = store.get(c.req.param("id"));
    if (!session) return jsonError("session not found", 404);
    const parsed = parseModelRef(session.model);
    const info = parsed ? modelInfoFor(parsed.provider, parsed.model) : undefined;
    const result = compactMessages(store.readMessages(session.id), {
      contextWindow: info?.contextWindow ?? 128_000,
      keepRecent: 6,
    });
    store.replaceMessages(session.id, result.messages);
    for (const key of [...context.agents.keys()]) {
      if (key.startsWith(`${session.id}:`)) context.agents.delete(key);
    }
    return c.json(result);
  });

  app.post("/sessions/:id/permissions/:requestID", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { decision?: unknown };
    const decision = body.decision;
    if (decision !== "allow" && decision !== "deny" && decision !== "ask") {
      return jsonError("decision must be allow or deny");
    }
    const entry = context.pending.get(c.req.param("requestID"));
    if (!entry || entry.request.sessionID !== c.req.param("id")) {
      return jsonError("permission request not found", 404);
    }
    const resolved = resolvePermission(c.req.param("requestID"), decision);
    return resolved ? c.json({ resolved: true }) : jsonError("permission request not found", 404);
  });

  app.post("/sessions/:id/prompt", async (c) => {
    const session = store.get(c.req.param("id"));
    if (!session) return jsonError("session not found", 404);

    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    if (prompt.length === 0) return jsonError("prompt is required");

    const model = typeof body.model === "string" ? body.model : undefined;
    const permissionMode = parsePermissionMode(body.permissionMode);

    let agent: Agent;
    try {
      agent = getAgent(session, model, permissionMode);
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : String(error));
    }

    if (context.aborts.has(session.id)) {
      return jsonError("session is already running", 409);
    }

    const controller = new AbortController();
    context.aborts.set(session.id, controller);
    const onAbort = () => {
      controller.abort();
      denyPending(session.id);
      if (context.aborts.get(session.id) === controller) {
        context.aborts.delete(session.id);
      }
    };
    c.req.raw.signal.addEventListener("abort", onAbort, { once: true });

    return streamSSE(c, async (stream) => {
      try {
        await agent.prompt(prompt, {
          signal: controller.signal,
          onEvent: async (event) => {
            await stream.writeSSE({ data: JSON.stringify({ event }) });
          },
        });
        await stream.writeSSE({ data: JSON.stringify({ event: { type: "done" } }) });
      } catch (error) {
        await stream.writeSSE({
          data: JSON.stringify({
            event: {
              type: "error",
              message: error instanceof Error ? error.message : String(error),
            },
          }),
        });
      } finally {
        c.req.raw.signal.removeEventListener("abort", onAbort);
        if (context.aborts.get(session.id) === controller) {
          context.aborts.delete(session.id);
        }
      }
    });
  });

  return {
    app,
    context,
    config: loaded.config,
    close: () => {
      for (const controller of context.aborts.values()) controller.abort();
      for (const entry of context.pending.values()) {
        clearTimeout(entry.timer);
        entry.resolve("deny");
      }
      context.aborts.clear();
      context.pending.clear();
      context.agents.clear();
      for (const connection of mcpConnections) {
        void connection.close().catch(() => undefined);
      }
      store.close();
    },
  };
}

export async function startServer(
  options: ServerOptions & { port?: number; hostname?: string } = {},
): Promise<{
  app: Hono;
  url: string;
  close: () => Promise<void>;
}> {
  const { app, close } = await createHarnessApp(options);
  const port = options.port ?? 4_096;
  const hostname = options.hostname ?? "127.0.0.1";
  const server = serve({ fetch: app.fetch, port, hostname });
  const env = options.env ?? process.env;
  const closeWebSocket = attachWebSocket(server, app, env.HARNESS_TOKEN);
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
  const address = server.address();
  const actualPort = typeof address === "object" && address !== null ? address.port : port;

  return {
    app,
    url: `http://${hostname}:${actualPort}`,
    close: async () => {
      closeWebSocket();
      close();
      (server as { closeAllConnections?: () => void }).closeAllConnections?.();
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => resolve(), 2_000);
        server.close(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    },
  };
}
