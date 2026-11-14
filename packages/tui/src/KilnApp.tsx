import { join, resolve } from "node:path";
import {
  Agent,
  type AgentEvent,
  AuditLog,
  CheckpointManager,
  createDefaultProviderRegistry,
  createDefaultToolRegistry,
  estimateMessagesTokens,
  type PermissionAskRequest,
  PermissionEngine,
  type ProviderRegistry,
  SessionStore,
  type ToolRegistry,
} from "@kiln/core";
import { LspManager, type LspServerConfig } from "@kiln/lsp";
import { createSandbox } from "@kiln/sandbox";
import {
  createLogger,
  ids,
  type KilnConfig,
  loadConfig,
  type PermissionDecision,
  type PermissionMode,
  parseModelRef,
  type Session,
} from "@kiln/shared";
import { Box, render, Text, useApp } from "ink";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Composer } from "./components/Composer";
import { PermissionModal, type PermissionRequestView } from "./components/PermissionModal";
import { SessionPicker } from "./components/SessionPicker";
import { StatusBar } from "./components/StatusBar";
import { Transcript, type TranscriptEntry } from "./components/Transcript";
import { resolveTheme } from "./theme";

export interface KilnTuiOptions {
  cwd?: string;
  model?: string;
  permissionMode?: PermissionMode;
  initialPrompt?: string;
  env?: NodeJS.ProcessEnv;
  dataDir?: string;
  agent?: string;
  registry?: ProviderRegistry;
  tools?: ToolRegistry;
}

const HELP = [
  "Commands:",
  "  /help              show this help",
  "  /clear             clear the transcript",
  "  /new               start a new session",
  "  /sessions          browse and open sessions",
  "  /model [ref]       show or set provider/model",
  "  /compact           compact the current context",
  "  /cost              show token usage and cost",
  "  /context           show context size",
  "  /doctor            environment diagnostics hint",
  "  /exit              quit",
].join("\n");

function transcriptFromMessages(
  messages: Array<{ role: string; content: string }>,
): TranscriptEntry[] {
  return messages.map((message) => ({
    id: ids.part(),
    kind: message.role === "assistant" ? "assistant" : message.role === "tool" ? "info" : "user",
    text: message.content,
  })) as TranscriptEntry[];
}

export function KilnApp(options: KilnTuiOptions): React.ReactNode {
  const { exit } = useApp();
  const env = options.env ?? process.env;
  const cwd = resolve(options.cwd ?? process.cwd());
  const theme = useMemo(() => resolveTheme(env), [env]);

  const store = useMemo(() => new SessionStore({ dataDir: options.dataDir }), [options.dataDir]);
  const registry = useMemo(
    () => options.registry ?? createDefaultProviderRegistry(env),
    [env, options.registry],
  );
  const logger = useMemo(() => createLogger({ level: env.KILN_LOG_LEVEL ?? "info" }), [env]);
  const audit = useMemo(() => new AuditLog(join(store.dataDir, "audit.jsonl")), [store]);
  const checkpoints = useMemo(() => new CheckpointManager(store.dataDir), [store]);

  const [config, setConfig] = useState<KilnConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [agent, setAgent] = useState<Agent | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [status, setStatus] = useState<"idle" | "running" | "waiting_permission" | "error">("idle");
  const [permissionRequest, setPermissionRequest] = useState<PermissionRequestView | null>(null);
  const [showSessions, setShowSessions] = useState(false);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [history, setHistory] = useState<string[]>([]);
  const [modelOverride, setModelOverride] = useState(options.model);

  const agentRef = useRef<Agent | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lspRef = useRef<LspManager | null>(null);
  const permissionResolve = useRef<((decision: PermissionDecision) => void) | null>(null);
  const initialPrompt = useRef(options.initialPrompt);

  const addInfo = useCallback((text: string) => {
    setEntries((previous) => [...previous, { id: ids.part(), kind: "info", text }]);
  }, []);

  const askPermission = useCallback(
    (request: PermissionAskRequest) =>
      new Promise<PermissionDecision>((resolve) => {
        permissionResolve.current = resolve;
        setPermissionRequest(request);
        setStatus("waiting_permission");
      }),
    [],
  );

  const createAgent = useCallback(
    (existing?: Session): Agent | null => {
      if (!config) return null;

      abortRef.current?.abort();
      abortRef.current = null;

      const modelRef = modelOverride ?? existing?.model ?? config.model ?? env.KILN_MODEL;
      if (!modelRef) {
        addInfo("No model configured. Use /model <provider/model> or set model in config.");
        return null;
      }

      const parsed = parseModelRef(modelRef);
      const provider = parsed ? registry.get(parsed.provider) : undefined;
      if (!parsed || !provider) {
        addInfo(`No provider configured for ${modelRef}. Use /model <provider/model>.`);
        return null;
      }

      const agentCwd = existing?.cwd ?? cwd;
      const permissionMode =
        options.permissionMode ?? existing?.permissions ?? config.permissions.default;
      const permissions = new PermissionEngine({
        mode: permissionMode,
        cwd: agentCwd,
        rules: config.permissions.rules,
      });

      const lsp = new LspManager(config.lsp.servers as Record<string, LspServerConfig>, agentCwd);
      void lspRef.current?.close();
      lspRef.current = lsp;

      const next = new Agent({
        cwd: agentCwd,
        provider,
        model: parsed.model,
        tools: options.tools ?? createDefaultToolRegistry(),
        permissions,
        logger,
        agent: options.agent ?? config.agent,
        store,
        session: existing,
        audit,
        checkpoints,
        askPermission,
        sandbox: config.sandbox.enabled
          ? createSandbox({ workspace: agentCwd, network: config.sandbox.network })
          : undefined,
        lsp,
      });

      setAgent(next);
      setSession(next.getSession());
      return next;
    },
    [
      addInfo,
      askPermission,
      audit,
      checkpoints,
      config,
      cwd,
      env,
      logger,
      modelOverride,
      options.agent,
      options.permissionMode,
      options.tools,
      registry,
      store,
    ],
  );

  const handleEvent = useCallback(
    (event: AgentEvent) => {
      switch (event.type) {
        case "assistant.text": {
          setEntries((previous) => {
            const last = previous[previous.length - 1];
            if (last && last.kind === "assistant" && last.streaming) {
              return [...previous.slice(0, -1), { ...last, text: last.text + event.text }];
            }
            return [
              ...previous,
              { id: ids.part(), kind: "assistant", text: event.text, streaming: true },
            ];
          });
          break;
        }
        case "assistant.message": {
          setEntries((previous) => {
            const last = previous[previous.length - 1];
            if (last && last.kind === "assistant" && last.streaming) {
              const text = event.text || last.text;
              const next = text.length > 0 ? { ...last, text, streaming: false } : null;
              return next ? [...previous.slice(0, -1), next] : previous.slice(0, -1);
            }
            return event.text.length > 0
              ? [...previous, { id: ids.part(), kind: "assistant", text: event.text }]
              : previous;
          });
          break;
        }
        case "tool.call": {
          setEntries((previous) => [
            ...previous,
            { id: event.call.id, kind: "tool", call: event.call },
          ]);
          break;
        }
        case "tool.result": {
          setEntries((previous) =>
            previous.map((entry) =>
              entry.kind === "tool" && entry.call.id === event.callID
                ? {
                    ...entry,
                    result: event.output,
                    decision: event.decision,
                    durationMs: event.durationMs,
                  }
                : entry,
            ),
          );
          break;
        }
        case "permission.denied":
          break;
        case "compaction.started":
          addInfo(`Compacting context (${event.tokensBefore} tokens)...`);
          break;
        case "compaction.completed":
          addInfo(`Context compacted (${event.tokensAfter} tokens).`);
          break;
        case "turn.end": {
          setStatus("idle");
          const current = agentRef.current;
          if (current) setSession(current.getSession());
          break;
        }
        case "error":
          setEntries((previous) => [
            ...previous,
            { id: ids.part(), kind: "error", text: event.error.message },
          ]);
          setStatus("error");
          break;
      }
    },
    [addInfo],
  );

  const submitPrompt = useCallback(
    async (text: string) => {
      const current = agentRef.current;
      if (!current) return;
      if (abortRef.current) {
        addInfo("Agent is busy. Press Esc to interrupt.");
        return;
      }

      setHistory((previous) => [...previous, text]);
      setEntries((previous) => [...previous, { id: ids.part(), kind: "user", text }]);
      setStatus("running");

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        await current.prompt(text, {
          signal: controller.signal,
          onEvent: handleEvent,
        });
      } catch {
        // The error event is already in the transcript.
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        setStatus((currentStatus) =>
          currentStatus === "error" || currentStatus === "waiting_permission"
            ? currentStatus
            : "idle",
        );
        const latest = agentRef.current;
        if (latest) setSession(latest.getSession());
      }
    },
    [addInfo, handleEvent],
  );

  const openSession = useCallback(
    (sessionID: string) => {
      const existing = store.get(sessionID);
      if (!existing) return;
      const next = createAgent(existing);
      if (!next) return;
      setShowSessions(false);
      setEntries(transcriptFromMessages(store.readMessages(sessionID)));
      setStatus("idle");
      addInfo(`Opened session ${sessionID}.`);
    },
    [addInfo, createAgent, store],
  );

  const handleExit = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    void lspRef.current?.close();
    lspRef.current = null;
    store.close();
    exit();
  }, [exit, store]);

  const runCommand = useCallback(
    async (input: string) => {
      const [command, ...args] = input.slice(1).split(/\s+/);
      const current = agentRef.current;

      if (
        (status === "running" || status === "waiting_permission") &&
        !["help", "cost", "context", "exit"].includes(command ?? "")
      ) {
        addInfo("Wait for the current turn to finish.");
        return;
      }

      switch (command) {
        case "help":
          addInfo(HELP);
          break;
        case "clear": {
          const next = createAgent();
          if (next) setEntries([]);
          break;
        }
        case "exit":
        case "quit":
          handleExit();
          break;
        case "new": {
          const next = createAgent();
          if (next) {
            setEntries([]);
            addInfo(`New session ${next.id}.`);
          }
          break;
        }
        case "sessions":
          setSessions(store.list({ cwd, limit: 50 }));
          setShowSessions(true);
          break;
        case "compact":
          if (current) {
            await current.compact();
            setSession(current.getSession());
            addInfo("Context compacted.");
          }
          break;
        case "cost": {
          const snapshot = current?.getSession();
          addInfo(
            `Cost: $${snapshot?.cost.toFixed(6) ?? "0.000000"} · tokens ↑${snapshot?.tokens.input ?? 0} ↓${snapshot?.tokens.output ?? 0}`,
          );
          break;
        }
        case "context": {
          const messages = current?.getMessages() ?? [];
          addInfo(`Messages: ${messages.length} · ~${estimateMessagesTokens(messages)} tokens`);
          break;
        }
        case "model": {
          const ref = args[0];
          if (!ref) {
            addInfo(`Current model: ${current?.getSession().model ?? "unknown"}`);
            break;
          }
          if (!current) break;
          setModelOverride(ref);
          store.update(current.id, { model: ref });
          const next = createAgent({ ...current.getSession(), model: ref });
          if (next) addInfo(`Model set to ${ref}.`);
          break;
        }
        case "doctor":
          addInfo("Run `kiln doctor` outside the TUI for environment diagnostics.");
          break;
        case "mcp":
        case "plugins":
        case "agents":
          addInfo(`${command} management lands in M4.`);
          break;
        default:
          addInfo(`Unknown command: /${command}. Try /help.`);
      }
    },
    [addInfo, createAgent, cwd, handleExit, status, store],
  );

  const send = useCallback(
    (text: string) => {
      if (text.startsWith("/")) {
        void runCommand(text).catch((error: unknown) => {
          addInfo(`Command failed: ${error instanceof Error ? error.message : String(error)}`);
        });
        return;
      }
      void submitPrompt(text);
    },
    [addInfo, runCommand, submitPrompt],
  );

  const resolvePermission = useCallback((decision: PermissionDecision) => {
    const resolve = permissionResolve.current;
    permissionResolve.current = null;
    setPermissionRequest(null);
    setStatus("running");
    resolve?.(decision);
  }, []);

  const alwaysAllow = useCallback(() => {
    const request = permissionRequest;
    try {
      if (request && agentRef.current) {
        agentRef.current.getPermissions().addRule({
          tool: request.tool,
          decision: "allow",
          scope: "session",
        });
      }
    } catch {
      // Permission resolution must not get stuck on a bad rule.
    } finally {
      resolvePermission("allow");
    }
  }, [permissionRequest, resolvePermission]);

  useEffect(() => {
    let cancelled = false;
    loadConfig({ cwd, env })
      .then((loaded) => {
        if (!cancelled) setConfig(loaded.config);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setConfigError(error instanceof Error ? error.message : String(error));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [cwd, env]);

  useEffect(() => {
    agentRef.current = agent;
  }, [agent]);

  useEffect(() => {
    if (!config) return;
    if (!agentRef.current) createAgent();
  }, [config, createAgent]);

  useEffect(() => {
    const prompt = initialPrompt.current;
    if (!agent || !prompt) return;
    initialPrompt.current = undefined;
    send(prompt);
  }, [agent, send]);

  if (configError) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text color={theme.error}>Configuration error: {configError}</Text>
      </Box>
    );
  }

  if (!config) {
    return <Text>Loading kiln...</Text>;
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text bold color={theme.accent}>
          kiln
        </Text>
        <Text color={theme.dim}> · {cwd}</Text>
      </Box>

      <Transcript entries={entries} theme={theme} />

      {permissionRequest ? (
        <PermissionModal
          theme={theme}
          request={permissionRequest}
          onResolve={resolvePermission}
          onAlwaysAllow={alwaysAllow}
        />
      ) : null}

      {showSessions ? (
        <SessionPicker
          theme={theme}
          sessions={sessions}
          onSelect={openSession}
          onClose={() => setShowSessions(false)}
        />
      ) : null}

      <StatusBar
        theme={theme}
        sessionID={session?.id ?? agent?.id ?? "no-session"}
        model={session?.model ?? "unknown"}
        cwd={cwd}
        status={status}
        usage={session?.tokens ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }}
        cost={session?.cost ?? 0}
      />

      <Composer
        theme={theme}
        disabled={permissionRequest !== null || showSessions}
        history={history}
        onSubmit={send}
        onInterrupt={() => abortRef.current?.abort()}
        onExit={handleExit}
      />
    </Box>
  );
}

export function renderKilnTui(options: KilnTuiOptions = {}): void {
  render(<KilnApp {...options} />);
}
