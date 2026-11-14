import {
  type ChatMessage,
  emptyUsage,
  type ModelInfo,
  type ProviderAdapter,
  type ProviderCapabilities,
  type StreamEvent,
  type StreamRequest,
} from "@harness/shared";
import { fetchJson, numberOr, openSse, sseData } from "./http";
import { modelInfoFor } from "./models";

export interface AnthropicOptions {
  apiKey: string;
  baseURL?: string;
}

interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

type AnthropicEvent =
  | { type: "message_start"; message?: { usage?: AnthropicUsage } }
  | {
      type: "content_block_start";
      index: number;
      content_block?: { type?: string; id?: string; name?: string; text?: string };
    }
  | {
      type: "content_block_delta";
      index: number;
      delta?: { type?: string; text?: string; partial_json?: string; thinking?: string };
    }
  | { type: "content_block_stop"; index: number }
  | { type: "message_delta"; delta?: { stop_reason?: string }; usage?: AnthropicUsage }
  | { type: "message_stop" }
  | { type: "error"; error?: { message?: string } }
  | { type: "ping" };

interface AnthropicContent {
  type: string;
  [key: string]: unknown;
}

interface InternalMessage {
  role: "user" | "assistant";
  content: string | AnthropicContent[];
  toolGroup?: boolean;
}

function toAnthropicMessages(messages: ChatMessage[]): InternalMessage[] {
  const result: InternalMessage[] = [];

  for (const message of messages) {
    if (message.role === "system") {
      result.push({ role: "user", content: message.content });
      continue;
    }

    if (message.role === "tool") {
      const block: AnthropicContent = {
        type: "tool_result",
        tool_use_id: message.toolCallID,
        content: message.content,
      };
      const last = result[result.length - 1];
      if (last && last.role === "user" && last.toolGroup && Array.isArray(last.content)) {
        last.content.push(block);
      } else {
        result.push({ role: "user", content: [block], toolGroup: true });
      }
      continue;
    }

    if (message.role === "assistant") {
      const content: AnthropicContent[] = [];
      if (message.content.length > 0) {
        content.push({ type: "text", text: message.content });
      }
      for (const call of message.toolCalls ?? []) {
        content.push({
          type: "tool_use",
          id: call.id,
          name: call.name,
          input: call.input,
        });
      }
      if (content.length === 0) content.push({ type: "text", text: "." });
      result.push({ role: "assistant", content });
      continue;
    }

    result.push({ role: "user", content: message.content });
  }

  return mergeAdjacent(result.map(({ role, content }) => ({ role, content })));
}

function mergeAdjacent(messages: InternalMessage[]): InternalMessage[] {
  const merged: InternalMessage[] = [];

  for (const message of messages) {
    const last = merged[merged.length - 1];
    if (!last || last.role !== message.role) {
      merged.push({
        ...message,
        content: Array.isArray(message.content) ? [...message.content] : message.content,
      });
      continue;
    }

    if (typeof last.content === "string" && typeof message.content === "string") {
      last.content += `\n\n${message.content}`;
    } else if (Array.isArray(last.content) && Array.isArray(message.content)) {
      last.content.push(...message.content);
    } else if (typeof last.content === "string" && Array.isArray(message.content)) {
      last.content = [{ type: "text", text: last.content }, ...message.content];
    } else if (Array.isArray(last.content) && typeof message.content === "string") {
      last.content.push({ type: "text", text: message.content });
    }
  }

  return merged;
}

export class AnthropicProvider implements ProviderAdapter {
  readonly id = "anthropic";
  readonly capabilities: ProviderCapabilities = {
    streaming: true,
    toolCalls: true,
    vision: true,
    reasoning: true,
    promptCache: true,
  };

  constructor(private readonly options: AnthropicOptions) {}

  private get baseURL(): string {
    return (this.options.baseURL ?? "https://api.anthropic.com").replace(/\/$/, "");
  }

  private headers(): Record<string, string> {
    return {
      "content-type": "application/json",
      "x-api-key": this.options.apiKey,
      "anthropic-version": "2023-06-01",
    };
  }

  async listModels(): Promise<ModelInfo[]> {
    const response = (await fetchJson(
      `${this.baseURL}/v1/models?limit=100`,
      { headers: this.headers() },
      new AbortController().signal,
    )) as { data?: Array<{ id?: string }> };

    return (response.data ?? [])
      .map((model) => model.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0)
      .map((id) => modelInfoFor("anthropic", id));
  }

  async *stream(request: StreamRequest): AsyncIterable<StreamEvent> {
    const usage = emptyUsage();
    let stopReason = "stop";

    const body = {
      model: request.model,
      max_tokens: request.maxTokens ?? 8_192,
      stream: true,
      ...(request.system ? { system: request.system } : {}),
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      messages: toAnthropicMessages(request.messages),
      ...(request.tools && request.tools.length > 0
        ? {
            tools: request.tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              input_schema: tool.parameters,
            })),
          }
        : {}),
    };

    const response = await openSse(
      `${this.baseURL}/v1/messages`,
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
      },
      request.signal,
    );

    const toolBlocks = new Map<number, { id: string; name: string; args: string }>();

    for await (const data of sseData(response)) {
      if (data === "[DONE]") break;

      let event: AnthropicEvent;
      try {
        event = JSON.parse(data) as AnthropicEvent;
      } catch {
        continue;
      }

      switch (event.type) {
        case "message_start": {
          const raw = event.message?.usage;
          if (raw) {
            usage.input = numberOr(raw.input_tokens, usage.input);
            usage.cacheRead = numberOr(raw.cache_read_input_tokens, usage.cacheRead);
            usage.cacheWrite = numberOr(raw.cache_creation_input_tokens, usage.cacheWrite);
          }
          break;
        }
        case "content_block_start": {
          const block = event.content_block;
          if (block?.type === "tool_use" && block.id && block.name) {
            toolBlocks.set(event.index, { id: block.id, name: block.name, args: "" });
            yield { type: "tool-call-start", callID: block.id, tool: block.name };
          } else if (block?.text) {
            yield { type: "text-delta", text: block.text };
          }
          break;
        }
        case "content_block_delta": {
          const delta = event.delta;
          if (!delta) break;
          if (delta.type === "text_delta" && delta.text) {
            yield { type: "text-delta", text: delta.text };
          } else if (delta.type === "thinking_delta" && delta.thinking) {
            yield { type: "reasoning-delta", text: delta.thinking };
          } else if (delta.type === "input_json_delta" && delta.partial_json) {
            const block = toolBlocks.get(event.index);
            if (block) {
              block.args += delta.partial_json;
              yield { type: "tool-call-delta", callID: block.id, argsDelta: delta.partial_json };
            }
          }
          break;
        }
        case "content_block_stop": {
          const block = toolBlocks.get(event.index);
          if (block) {
            if (block.args.trim().length === 0) {
              yield { type: "tool-call-delta", callID: block.id, argsDelta: "{}" };
            }
            yield { type: "tool-call-end", callID: block.id };
            toolBlocks.delete(event.index);
          }
          break;
        }
        case "message_delta": {
          if (event.delta?.stop_reason) stopReason = event.delta.stop_reason;
          const raw = event.usage;
          if (raw) usage.output = numberOr(raw.output_tokens, usage.output);
          break;
        }
        case "message_stop": {
          break;
        }
        case "error": {
          yield {
            type: "error",
            message: event.error?.message ?? "Anthropic stream error",
            retryable: true,
          };
          break;
        }
        default:
          break;
      }
    }

    if (usage.input > 0 || usage.output > 0) {
      yield { type: "usage", usage };
    }
    yield { type: "finish", reason: stopReason };
  }
}
