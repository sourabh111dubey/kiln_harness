import type { ModelInfo, Usage } from "./usage";

export interface ProviderCapabilities {
  streaming: boolean;
  toolCalls: boolean;
  vision: boolean;
  reasoning: boolean;
  promptCache: boolean;
}

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  role: ChatRole;
  content: string;
  toolCalls?: ToolCall[];
  toolCallID?: string;
  name?: string;
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export type StreamEvent =
  | { type: "text-delta"; text: string }
  | { type: "reasoning-delta"; text: string }
  | { type: "tool-call-start"; callID: string; tool: string }
  | { type: "tool-call-delta"; callID: string; argsDelta: string }
  | { type: "tool-call-end"; callID: string }
  | { type: "usage"; usage: Usage }
  | { type: "finish"; reason: string }
  | { type: "error"; message: string; retryable: boolean };

export interface StreamRequest {
  model: string;
  system?: string;
  messages: ChatMessage[];
  tools?: ToolSpec[];
  maxTokens?: number;
  temperature?: number;
  signal: AbortSignal;
}

export interface ProviderAdapter {
  readonly id: string;
  readonly capabilities: ProviderCapabilities;
  listModels(): Promise<ModelInfo[]>;
  stream(request: StreamRequest): AsyncIterable<StreamEvent>;
}
