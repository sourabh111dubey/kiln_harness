import type { Logger } from "pino";
import type { KilnEvent } from "./events";
import type { ChatMessage, ToolCall } from "./provider";
import type { ToolOutput } from "./schemas";
import type { ToolDefinition } from "./tool";

export interface PluginContext {
  cwd: string;
  dataDir: string;
  logger: Logger;
}

export interface SessionStartPayload {
  sessionID: string;
  cwd: string;
  model: string;
}

export interface MessagePayload {
  sessionID: string;
  message: ChatMessage;
}

export interface ToolBeforePayload {
  sessionID: string;
  call: ToolCall;
}

export interface ToolAfterPayload {
  sessionID: string;
  call: ToolCall;
  output: ToolOutput;
}

export interface PluginHooks {
  "session.start"?: (context: PluginContext, payload: SessionStartPayload) => void | Promise<void>;
  "message.received"?: (
    context: PluginContext,
    payload: MessagePayload,
  ) => ChatMessage | undefined | Promise<ChatMessage | undefined>;
  "tool.before"?: (
    context: PluginContext,
    payload: ToolBeforePayload,
  ) => ToolCall | "block" | undefined | Promise<ToolCall | "block" | undefined>;
  "tool.after"?: (
    context: PluginContext,
    payload: ToolAfterPayload,
  ) => ToolOutput | undefined | Promise<ToolOutput | undefined>;
  event?: (context: PluginContext, event: KilnEvent) => void | Promise<void>;
}

export interface PluginCommand {
  name: string;
  description: string;
  template: string;
}

export interface Plugin {
  id: string;
  version?: string;
  hooks?: PluginHooks;
  tools?: ToolDefinition<unknown>[];
  commands?: PluginCommand[];
}

export type PluginModule = Plugin | { default: Plugin } | { plugin: Plugin };
