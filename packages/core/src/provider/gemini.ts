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

export interface GeminiOptions {
  apiKey: string;
  baseURL?: string;
}

interface GeminiPart {
  text?: string;
  functionCall?: { name?: string; args?: unknown };
  functionResponse?: { name?: string; response?: { result?: string } };
}

interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

interface GeminiChunk {
  candidates?: Array<{
    content?: { parts?: GeminiPart[] };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    cachedContentTokenCount?: number;
  };
}

const UNSUPPORTED_JSON_SCHEMA_KEYS = new Set([
  "additionalProperties",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "const",
  "oneOf",
  "allOf",
  "not",
  "uniqueItems",
  "multipleOf",
  "patternProperties",
  "propertyNames",
  "dependencies",
]);

function cleanSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cleanSchema);
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (UNSUPPORTED_JSON_SCHEMA_KEYS.has(key)) continue;
      result[key] = cleanSchema(entry);
    }
    return result;
  }
  return value;
}

function cleanParameters(parameters: Record<string, unknown>): Record<string, unknown> {
  return cleanSchema(structuredClone(parameters)) as Record<string, unknown>;
}

function toGeminiContents(messages: ChatMessage[]): GeminiContent[] {
  const contents: GeminiContent[] = [];

  for (const message of messages) {
    if (message.role === "system") {
      const last = contents[contents.length - 1];
      if (last && last.role === "user") last.parts.push({ text: message.content });
      else contents.push({ role: "user", parts: [{ text: message.content }] });
      continue;
    }

    if (message.role === "tool") {
      const part: GeminiPart = {
        functionResponse: {
          name: message.name ?? "tool",
          response: { result: message.content },
        },
      };
      const last = contents[contents.length - 1];
      if (last && last.role === "user" && last.parts.every((entry) => entry.functionResponse)) {
        last.parts.push(part);
      } else {
        contents.push({ role: "user", parts: [part] });
      }
      continue;
    }

    if (message.role === "assistant") {
      const parts: GeminiPart[] = [];
      if (message.content.length > 0) parts.push({ text: message.content });
      for (const call of message.toolCalls ?? []) {
        parts.push({
          functionCall: {
            name: call.name,
            args: isRecord(call.input) ? call.input : {},
          },
        });
      }
      if (parts.length > 0) contents.push({ role: "model", parts });
      continue;
    }

    contents.push({ role: "user", parts: [{ text: message.content }] });
  }

  return contents;
}

export class GeminiProvider implements ProviderAdapter {
  readonly id = "gemini";
  readonly capabilities: ProviderCapabilities = {
    streaming: true,
    toolCalls: true,
    vision: true,
    reasoning: true,
    promptCache: false,
  };

  constructor(private readonly options: GeminiOptions) {}

  private get baseURL(): string {
    return (this.options.baseURL ?? "https://generativelanguage.googleapis.com/v1beta").replace(
      /\/$/,
      "",
    );
  }

  async listModels(): Promise<ModelInfo[]> {
    const response = (await fetchJson(
      `${this.baseURL}/models`,
      { headers: { "x-goog-api-key": this.options.apiKey } },
      new AbortController().signal,
    )) as { models?: Array<{ name?: string }> };

    return (response.models ?? [])
      .map((model) => model.name?.replace(/^models\//, ""))
      .filter((id): id is string => typeof id === "string" && id.length > 0)
      .map((id) => modelInfoFor("gemini", id));
  }

  async *stream(request: StreamRequest): AsyncIterable<StreamEvent> {
    const usage = emptyUsage();
    let finishReason = "stop";
    let callCounter = 0;

    const model = request.model.replace(/^models\//, "");
    const body = {
      ...(request.system ? { systemInstruction: { parts: [{ text: request.system }] } } : {}),
      contents: toGeminiContents(request.messages),
      ...(request.tools && request.tools.length > 0
        ? {
            tools: [
              {
                functionDeclarations: request.tools.map((tool) => ({
                  name: tool.name,
                  description: tool.description,
                  parameters: cleanParameters(tool.parameters),
                })),
              },
            ],
          }
        : {}),
      generationConfig: {
        maxOutputTokens: request.maxTokens ?? 8_192,
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      },
    };

    const response = await openSse(
      `${this.baseURL}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": this.options.apiKey,
        },
        body: JSON.stringify(body),
      },
      request.signal,
    );

    for await (const data of sseData(response)) {
      if (data === "[DONE]") break;

      let chunk: GeminiChunk;
      try {
        chunk = JSON.parse(data) as GeminiChunk;
      } catch {
        continue;
      }

      const candidate = chunk.candidates?.[0];
      if (candidate?.finishReason) finishReason = candidate.finishReason;

      for (const part of candidate?.content?.parts ?? []) {
        if (typeof part.text === "string" && part.text.length > 0) {
          yield { type: "text-delta", text: part.text };
        }

        if (part.functionCall?.name) {
          const callID = `gemini_${Date.now().toString(36)}_${callCounter++}`;
          const args = JSON.stringify(part.functionCall.args ?? {});
          yield { type: "tool-call-start", callID, tool: part.functionCall.name };
          yield { type: "tool-call-delta", callID, argsDelta: args };
          yield { type: "tool-call-end", callID };
        }
      }

      if (chunk.usageMetadata) {
        usage.input = numberOr(chunk.usageMetadata.promptTokenCount, usage.input);
        usage.output = numberOr(chunk.usageMetadata.candidatesTokenCount, usage.output);
        usage.cacheRead = numberOr(chunk.usageMetadata.cachedContentTokenCount, usage.cacheRead);
      }
    }

    if (usage.input > 0 || usage.output > 0) {
      yield { type: "usage", usage };
    }
    yield { type: "finish", reason: finishReason };
  }
}
