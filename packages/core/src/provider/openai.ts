import {
  type ChatMessage,
  emptyUsage,
  type ModelInfo,
  type ProviderAdapter,
  type ProviderCapabilities,
  type StreamEvent,
  type StreamRequest,
} from "@kiln/shared";
import { fetchJson, isRecord, numberOr, openSse, sseData } from "./http";
import { modelInfoFor } from "./models";

export interface OpenAIOptions {
  id: string;
  apiKey?: string;
  baseURL: string;
  headers?: Record<string, string>;
}

interface OpenAIToolCallDelta {
  index?: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}

interface OpenAIChunk {
  choices?: Array<{
    delta?: { content?: string; tool_calls?: OpenAIToolCallDelta[] };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
}

function toOpenAIMessages(messages: ChatMessage[]): Array<Record<string, unknown>> {
  const result: Array<Record<string, unknown>> = [];

  for (const message of messages) {
    if (message.role === "assistant") {
      const entry: Record<string, unknown> = {
        role: "assistant",
        content: message.content.length > 0 ? message.content : null,
      };
      if (message.toolCalls && message.toolCalls.length > 0) {
        entry.tool_calls = message.toolCalls.map((call) => ({
          id: call.id,
          type: "function",
          function: {
            name: call.name,
            arguments: JSON.stringify(call.input),
          },
        }));
      }
      result.push(entry);
      continue;
    }

    if (message.role === "tool") {
      result.push({
        role: "tool",
        tool_call_id: message.toolCallID,
        content: message.content,
      });
      continue;
    }

    result.push({ role: message.role, content: message.content });
  }

  return result;
}

export class OpenAIProvider implements ProviderAdapter {
  readonly capabilities: ProviderCapabilities = {
    streaming: true,
    toolCalls: true,
    vision: true,
    reasoning: false,
    promptCache: false,
  };

  constructor(private readonly options: OpenAIOptions) {}

  get id(): string {
    return this.options.id;
  }

  private get baseURL(): string {
    return this.options.baseURL.replace(/\/$/, "");
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      ...this.options.headers,
    };
    if (this.options.apiKey) headers.authorization = `Bearer ${this.options.apiKey}`;
    return headers;
  }

  async listModels(): Promise<ModelInfo[]> {
    const response = (await fetchJson(
      `${this.baseURL}/models`,
      { headers: this.headers() },
      new AbortController().signal,
    )) as { data?: Array<{ id?: string }> };

    return (response.data ?? [])
      .map((model) => model.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0)
      .map((id) => modelInfoFor(this.id, id));
  }

  async *stream(request: StreamRequest): AsyncIterable<StreamEvent> {
    const usage = emptyUsage();
    const pending = new Map<number, { id: string; name: string; args: string; started: boolean }>();
    let finishReason = "stop";

    const body = {
      model: request.model,
      messages: toOpenAIMessages(request.messages),
      stream: true,
      stream_options: { include_usage: true },
      ...(request.tools && request.tools.length > 0
        ? {
            tools: request.tools.map((tool) => ({
              type: "function",
              function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters,
              },
            })),
            tool_choice: "auto",
          }
        : {}),
      ...(request.maxTokens !== undefined
        ? {
            [/^(gpt-5|o1|o3|o4)/.test(request.model.toLowerCase())
              ? "max_completion_tokens"
              : "max_tokens"]: request.maxTokens,
          }
        : {}),
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
    };

    const response = await openSse(
      `${this.baseURL}/chat/completions`,
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
      },
      request.signal,
    );

    for await (const data of sseData(response)) {
      if (data === "[DONE]") break;

      let chunk: OpenAIChunk;
      try {
        chunk = JSON.parse(data) as OpenAIChunk;
      } catch {
        continue;
      }

      const choice = chunk.choices?.[0];
      if (choice?.finish_reason) finishReason = choice.finish_reason;

      const delta = choice?.delta;
      if (delta?.content) {
        yield { type: "text-delta", text: delta.content };
      }

      for (const call of delta?.tool_calls ?? []) {
        const index = call.index ?? 0;
        const entry = pending.get(index) ?? { id: "", name: "", args: "", started: false };

        if (call.id) entry.id = call.id;
        if (call.function?.name) entry.name = call.function.name;

        if (!entry.started && entry.id.length > 0 && entry.name.length > 0) {
          entry.started = true;
          yield { type: "tool-call-start", callID: entry.id, tool: entry.name };
          if (entry.args.length > 0) {
            yield { type: "tool-call-delta", callID: entry.id, argsDelta: entry.args };
          }
        }

        if (call.function?.arguments) {
          entry.args += call.function.arguments;
          if (entry.started) {
            yield {
              type: "tool-call-delta",
              callID: entry.id,
              argsDelta: call.function.arguments,
            };
          }
        }

        pending.set(index, entry);
      }

      if (chunk.usage) {
        usage.input = numberOr(chunk.usage.prompt_tokens, usage.input);
        usage.output = numberOr(chunk.usage.completion_tokens, usage.output);
        usage.cacheRead = numberOr(
          chunk.usage.prompt_tokens_details?.cached_tokens,
          usage.cacheRead,
        );
      }
    }

    const ordered = [...pending.entries()].sort(([left], [right]) => left - right);
    for (const [index, entry] of ordered) {
      if (!entry.started) {
        const callID = entry.id || `call_${index}`;
        yield { type: "tool-call-start", callID, tool: entry.name || `tool_${index}` };
        if (entry.args.length > 0) {
          yield { type: "tool-call-delta", callID, argsDelta: entry.args };
        }
      }
      yield { type: "tool-call-end", callID: entry.id || `call_${index}` };
    }

    if (usage.input > 0 || usage.output > 0) {
      yield { type: "usage", usage };
    }
    yield { type: "finish", reason: finishReason };
  }
}

export function isOpenAiChunk(value: unknown): value is OpenAIChunk {
  return isRecord(value) && Array.isArray(value.choices);
}
