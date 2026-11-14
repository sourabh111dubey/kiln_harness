import type { LspManagerLike, SandboxAdapter } from "@harness/shared";
import {
  addUsage,
  type ChatMessage,
  emptyUsage,
  errors,
  estimateCost,
  HarnessError,
  ids,
  type PermissionDecision,
  type ProviderAdapter,
  type Session,
  type StreamEvent,
  type ToolCall,
  type ToolOutput,
  toHarnessError,
  type Usage,
} from "@harness/shared";
import type { Logger } from "pino";
import type { PermissionEngine } from "../permissions/engine";
import type { PluginHost } from "../plugin/host";
import { modelInfoFor } from "../provider/models";
import type { AuditLog } from "../session/audit";
import { hashInput, summarizeInput } from "../session/audit";
import type { CheckpointManager } from "../session/checkpoint";
import type { SessionStore } from "../session/store";
import { toolOutputToText } from "../tools/common";
import type { ToolRegistry } from "../tools/registry";
import type { Todo } from "../tools/todo";
import {
  type CompactionResult,
  compactMessages,
  estimateMessagesTokens,
  estimateTokens,
  shouldCompact,
} from "./compaction";
import { buildSystemPrompt } from "./prompt";

export type AgentEvent =
  | { type: "turn.start"; prompt: string }
  | { type: "assistant.text"; text: string }
  | { type: "assistant.message"; text: string; toolCalls: ToolCall[] }
  | { type: "tool.call"; call: ToolCall }
  | {
      type: "tool.result";
      callID: string;
      tool: string;
      output: ToolOutput;
      decision: PermissionDecision;
      durationMs: number;
    }
  | { type: "permission.requested"; requestID: string; request: PermissionAskRequest }
  | { type: "permission.denied"; call: ToolCall; reason: string }
  | { type: "compaction.started"; reason: string; tokensBefore: number }
  | { type: "compaction.completed"; summary: string; tokensAfter: number }
  | { type: "turn.end"; stopReason: string; usage: Usage; cost: number }
  | { type: "error"; error: HarnessError };

export interface PermissionAskRequest {
  id: string;
  sessionID: string;
  tool: string;
  input: unknown;
  reason?: string;
}

export interface AgentOptions {
  cwd: string;
  provider: ProviderAdapter;
  model: string;
  tools: ToolRegistry;
  permissions: PermissionEngine;
  logger: Logger;
  maxTurns?: number;
  maxTokens?: number;
  systemPrompt?: string;
  agent?: string;
  store?: SessionStore;
  session?: Session;
  audit?: AuditLog;
  checkpoints?: CheckpointManager;
  askPermission?: (request: PermissionAskRequest, requestID: string) => Promise<PermissionDecision>;
  plugins?: PluginHost;
  sandbox?: SandboxAdapter;
  lsp?: LspManagerLike;
}

export interface PromptRunOptions {
  onEvent?: (event: AgentEvent) => void | Promise<void>;
  signal?: AbortSignal;
}

export interface TurnResult {
  sessionID: string;
  text: string;
  usage: Usage;
  cost: number;
  toolCalls: number;
  stopReason: string;
}

interface ExecutedCall {
  call: ToolCall;
  output: ToolOutput;
  decision: PermissionDecision;
  durationMs: number;
}

function parseToolInput(raw: string): unknown {
  if (raw.trim().length === 0) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new HarnessError(
      "tool_error",
      `Model produced invalid tool input JSON: ${raw.slice(0, 300)}`,
    );
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(
        new HarnessError("tool_error", `Tool timed out after ${timeoutMs}ms`, {
          recoverable: false,
        }),
      );
    }, timeoutMs);

    const onAbort = () => {
      cleanup();
      reject(errors.aborted("Tool execution aborted"));
    };

    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
    };

    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
}

function fallbackSession(options: AgentOptions): Session {
  const timestamp = new Date().toISOString();
  const title =
    options.cwd
      .split(/[\\/]/)
      .filter((part) => part.length > 0)
      .at(-1) ?? "session";
  return {
    id: ids.session(),
    title,
    cwd: options.cwd,
    model: `${options.provider.id}/${options.model}`,
    agent: options.agent ?? "build",
    createdAt: timestamp,
    updatedAt: timestamp,
    status: "idle",
    tokens: emptyUsage(),
    cost: 0,
    permissions: options.permissions.mode,
    metadata: {},
  };
}

export class Agent {
  private messages: ChatMessage[] = [];
  private readonly state: Record<string, unknown> = {};
  private session: Session;
  private usage: Usage = emptyUsage();
  private cost = 0;
  private totalToolCalls = 0;
  private readonly modelInfo;

  constructor(private readonly options: AgentOptions) {
    this.modelInfo = modelInfoFor(options.provider.id, options.model);

    const session =
      options.session ??
      options.store?.create({
        cwd: options.cwd,
        model: `${options.provider.id}/${options.model}`,
        agent: options.agent,
        permissions: options.permissions.mode,
      });
    this.session = session ?? fallbackSession(options);

    if (options.store && session) {
      this.messages = options.store.readMessages(session.id);
      this.usage = { ...session.tokens };
      this.cost = session.cost;
      const todos = session.metadata.todos;
      if (Array.isArray(todos)) this.state.todos = todos;
    }
  }

  get id(): string {
    return this.session.id;
  }

  getSession(): Session {
    return this.session;
  }

  getMessages(): ChatMessage[] {
    return [...this.messages];
  }

  getUsage(): Usage {
    return { ...this.usage };
  }

  getCost(): number {
    return this.cost;
  }

  getPermissions(): PermissionEngine {
    return this.options.permissions;
  }

  getTodos(): Todo[] {
    const todos = this.state.todos;
    return Array.isArray(todos) ? (todos as Todo[]) : [];
  }

  async prompt(input: string, options: PromptRunOptions = {}): Promise<TurnResult> {
    const signal = options.signal ?? new AbortController().signal;
    const emit = async (event: AgentEvent): Promise<void> => {
      await options.onEvent?.(event);
      await this.persistEvent(event);
    };

    const maxTurns = this.options.maxTurns ?? 25;
    const system =
      this.options.systemPrompt ??
      buildSystemPrompt({
        cwd: this.options.cwd,
        model: this.options.model,
        tools: this.options.tools.list(),
        todos: this.getTodos(),
      });

    this.updateSession({ status: "running" });
    this.pushMessage({ role: "user", content: input });
    await emit({ type: "turn.start", prompt: input });
    await this.options.plugins?.sessionStart({
      sessionID: this.session.id,
      cwd: this.options.cwd,
      model: this.session.model,
    });

    let lastText = "";

    try {
      for (let turn = 0; turn < maxTurns; turn++) {
        if (signal.aborted) throw errors.aborted();

        await this.maybeCompact(system, emit);

        const stream = this.options.provider.stream({
          model: this.options.model,
          system,
          messages: this.messages,
          tools: this.options.tools.toSpecs(),
          maxTokens: this.options.maxTokens,
          signal,
        });

        const { text, calls } = await this.consumeStream(stream, emit);
        lastText = text;

        this.pushMessage({ role: "assistant", content: text, toolCalls: calls });
        await emit({ type: "assistant.message", text, toolCalls: calls });

        if (calls.length === 0) {
          return await this.finish(lastText, "stop", emit);
        }

        const executed = await this.executeCalls(calls, signal, emit);
        for (const entry of executed) {
          this.pushMessage({
            role: "tool",
            content: toolOutputToText(entry.output),
            toolCallID: entry.call.id,
            name: entry.call.name,
          });
        }
      }

      return await this.finish(lastText, "max_turns", emit);
    } catch (error) {
      const harnessError = toHarnessError(error);
      this.updateSession({ status: "error" });
      await emit({ type: "error", error: harnessError });
      throw harnessError;
    }
  }

  async compact(): Promise<CompactionResult> {
    const result = compactMessages(this.messages, {
      contextWindow: this.modelInfo.contextWindow,
      keepRecent: 6,
      threshold: 0.8,
    });
    this.messages = result.messages;
    this.options.store?.replaceMessages(this.session.id, this.messages);
    return result;
  }

  private async finish(
    text: string,
    stopReason: string,
    emit: (event: AgentEvent) => Promise<void>,
  ): Promise<TurnResult> {
    this.updateSession({
      status: "idle",
      tokens: this.usage,
      cost: this.cost,
      metadata: { ...this.session.metadata, todos: this.getTodos() },
    });
    await emit({
      type: "turn.end",
      stopReason,
      usage: this.usage,
      cost: this.cost,
    });
    return this.result(text, stopReason);
  }

  private result(text: string, stopReason: string): TurnResult {
    return {
      sessionID: this.session.id,
      text,
      usage: this.getUsage(),
      cost: this.cost,
      toolCalls: this.totalToolCalls,
      stopReason,
    };
  }

  private pushMessage(message: ChatMessage): void {
    this.messages.push(message);
    this.options.store?.appendMessage(this.session.id, message);
  }

  private updateSession(patch: Partial<Session>): void {
    if (this.options.store) {
      const updated = this.options.store.update(this.session.id, patch);
      if (updated) {
        this.session = updated;
        return;
      }
    }
    this.session = { ...this.session, ...patch, updatedAt: new Date().toISOString() };
  }

  private async maybeCompact(
    system: string,
    emit: (event: AgentEvent) => Promise<void>,
  ): Promise<void> {
    const options = {
      contextWindow: this.modelInfo.contextWindow,
      systemTokens: estimateTokens(system),
      keepRecent: 6,
      threshold: 0.8,
    };
    if (!shouldCompact(this.messages, options)) return;

    const tokensBefore = estimateMessagesTokens(this.messages);
    await emit({ type: "compaction.started", reason: "auto", tokensBefore });

    const result = compactMessages(this.messages, options);
    this.messages = result.messages;
    this.options.store?.replaceMessages(this.session.id, this.messages);

    await emit({
      type: "compaction.completed",
      summary: result.summary,
      tokensAfter: result.tokensAfter,
    });
  }

  private async persistEvent(event: AgentEvent): Promise<void> {
    try {
      const harnessEvent = this.toHarnessEvent(event);
      if (harnessEvent) {
        this.options.store?.appendEvent(this.session.id, harnessEvent);
        await this.options.plugins?.emit(harnessEvent);
      }
    } catch (error) {
      this.options.logger.warn({ err: error }, "failed to persist session event");
    }
  }

  private toHarnessEvent(event: AgentEvent) {
    switch (event.type) {
      case "turn.start":
        return {
          type: "turn.start" as const,
          turn: this.messages.length,
          prompt: event.prompt,
        };
      case "tool.result":
        return {
          type: "tool.result" as const,
          callID: event.callID,
          output: event.output,
        };
      case "compaction.started":
        return {
          type: "compaction.started" as const,
          reason: event.reason,
          tokensBefore: event.tokensBefore,
        };
      case "compaction.completed":
        return {
          type: "compaction.completed" as const,
          summary: event.summary,
          tokensAfter: event.tokensAfter,
        };
      case "turn.end":
        return {
          type: "turn.end" as const,
          turn: this.messages.length,
          stopReason: event.stopReason,
          usage: event.usage,
        };
      case "error":
        return {
          type: "error" as const,
          error: {
            code: event.error.code,
            message: event.error.message,
            recoverable: event.error.recoverable,
            details: event.error.details,
          },
          recoverable: event.error.recoverable,
        };
      default:
        return undefined;
    }
  }

  private async consumeStream(
    stream: AsyncIterable<StreamEvent>,
    emit: (event: AgentEvent) => Promise<void>,
  ): Promise<{ text: string; calls: ToolCall[] }> {
    let text = "";
    const calls: ToolCall[] = [];
    const active = new Map<string, { name: string; args: string }>();

    for await (const event of stream) {
      switch (event.type) {
        case "text-delta": {
          text += event.text;
          await emit({ type: "assistant.text", text: event.text });
          break;
        }
        case "reasoning-delta":
          break;
        case "tool-call-start": {
          active.set(event.callID, { name: event.tool, args: "" });
          break;
        }
        case "tool-call-delta": {
          const entry = active.get(event.callID);
          if (entry) entry.args += event.argsDelta;
          break;
        }
        case "tool-call-end": {
          const entry = active.get(event.callID);
          if (entry) {
            calls.push({
              id: event.callID,
              name: entry.name,
              input: parseToolInput(entry.args),
            });
            active.delete(event.callID);
          }
          break;
        }
        case "usage": {
          this.usage = addUsage(this.usage, event.usage);
          this.cost += estimateCost(this.modelInfo, event.usage);
          break;
        }
        case "finish":
          break;
        case "error":
          throw new HarnessError("provider_error", event.message, {
            recoverable: event.retryable,
          });
      }
    }

    for (const [callID, entry] of active) {
      calls.push({ id: callID, name: entry.name, input: parseToolInput(entry.args) });
    }

    return { text, calls };
  }

  private async executeCalls(
    calls: ToolCall[],
    signal: AbortSignal,
    emit: (event: AgentEvent) => Promise<void>,
  ): Promise<ExecutedCall[]> {
    const readOnly = calls.filter((call) => this.options.tools.get(call.name)?.readOnly === true);
    const mutating = calls.filter((call) => this.options.tools.get(call.name)?.readOnly !== true);

    const results: ExecutedCall[] = [];
    for (const call of mutating) {
      if (signal.aborted) throw errors.aborted();
      results.push(await this.executeOne(call, signal, emit));
    }

    const parallel = await Promise.all(readOnly.map((call) => this.executeOne(call, signal, emit)));
    results.push(...parallel);
    return results;
  }

  private async executeOne(
    call: ToolCall,
    signal: AbortSignal,
    emit: (event: AgentEvent) => Promise<void>,
  ): Promise<ExecutedCall> {
    const startedAt = Date.now();
    await emit({ type: "tool.call", call });
    this.totalToolCalls++;

    const before = await this.options.plugins?.toolBefore({
      sessionID: this.session.id,
      call,
    });
    if (before === "block") {
      const output: ToolOutput = {
        kind: "text",
        text: `Tool ${call.name} was blocked by a plugin.`,
      };
      const durationMs = Date.now() - startedAt;
      await this.emitResult(call, output, "deny", durationMs, emit);
      return { call, output, decision: "deny", durationMs };
    }
    if (before) call = before;

    const tool = this.options.tools.get(call.name);
    if (!tool) {
      const output: ToolOutput = {
        kind: "text",
        text: `Unknown tool: ${call.name}. Use one of the registered tools.`,
      };
      const durationMs = Date.now() - startedAt;
      await this.emitResult(call, output, "allow", durationMs, emit);
      return { call, output, decision: "allow", durationMs };
    }

    const parsed = tool.input.safeParse(call.input);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
        .join("; ");
      const output: ToolOutput = {
        kind: "text",
        text: `Invalid input for ${call.name}: ${issues}`,
      };
      const durationMs = Date.now() - startedAt;
      await this.emitResult(call, output, "allow", durationMs, emit);
      return { call, output, decision: "allow", durationMs };
    }

    let decision = this.options.permissions.decide({
      tool: call.name,
      input: parsed.data,
    });

    if (decision === "ask" && this.options.askPermission) {
      const requestID = ids.request();
      const request: PermissionAskRequest = {
        id: requestID,
        sessionID: this.session.id,
        tool: call.name,
        input: parsed.data,
        reason: `The model wants to use ${call.name}.`,
      };
      await emit({ type: "permission.requested", requestID, request });
      decision = await this.options.askPermission(request, requestID);
    }

    this.options.audit?.record({
      sessionID: this.session.id,
      tool: call.name,
      decision,
      cwd: this.options.cwd,
      inputHash: hashInput(parsed.data),
      summary: summarizeInput(parsed.data),
    });

    if (decision !== "allow") {
      const reason =
        decision === "deny"
          ? `Permission denied for ${call.name} in ${this.options.permissions.mode} mode.`
          : `Permission approval required for ${call.name}.`;
      const output: ToolOutput = { kind: "text", text: reason };
      await emit({ type: "permission.denied", call, reason });
      const durationMs = Date.now() - startedAt;
      await this.emitResult(call, output, decision, durationMs, emit);
      return { call, output, decision, durationMs };
    }

    try {
      const output = await withTimeout(
        tool.execute(parsed.data, {
          sessionID: this.session.id,
          cwd: this.options.cwd,
          workspaceRoot: this.options.cwd,
          signal,
          logger: this.options.logger,
          state: this.state,
          sandbox: this.options.sandbox,
          lsp: this.options.lsp,
          checkpoint: this.options.checkpoints
            ? (path: string) => {
                this.options.checkpoints?.snapshot(this.session.id, path);
              }
            : undefined,
        }),
        tool.timeoutMs ?? 120_000,
        signal,
      );

      const finalOutput =
        (await this.options.plugins?.toolAfter({
          sessionID: this.session.id,
          call,
          output,
        })) ?? output;
      const durationMs = Date.now() - startedAt;
      await this.emitResult(call, finalOutput, decision, durationMs, emit);
      return { call, output: finalOutput, decision, durationMs };
    } catch (error) {
      const harnessError = toHarnessError(error);
      const output: ToolOutput = {
        kind: "text",
        text: `Tool ${call.name} failed: ${harnessError.message}`,
      };
      const durationMs = Date.now() - startedAt;
      await this.emitResult(call, output, "deny", durationMs, emit);
      return { call, output, decision: "deny", durationMs };
    }
  }

  private async emitResult(
    call: ToolCall,
    output: ToolOutput,
    decision: PermissionDecision,
    durationMs: number,
    emit: (event: AgentEvent) => Promise<void>,
  ): Promise<void> {
    await emit({
      type: "tool.result",
      callID: call.id,
      tool: call.name,
      output,
      decision,
      durationMs,
    });
  }
}
