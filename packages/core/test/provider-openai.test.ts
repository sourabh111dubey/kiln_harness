import type { StreamRequest } from "@harness/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAIProvider } from "../src/provider/openai";
import { collect, sseResponse } from "./helpers";

const request: StreamRequest = {
  model: "gpt-5",
  messages: [{ role: "user", content: "hello" }],
  signal: new AbortController().signal,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(response: Response) {
  const mock = vi.fn<typeof fetch>(async () => response);
  vi.stubGlobal("fetch", mock);
  return mock;
}

describe("openai-compatible provider", () => {
  it("streams text and usage", async () => {
    stubFetch(
      sseResponse([
        'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
        'data: {"usage":{"prompt_tokens":4,"completion_tokens":2}}\n\n',
        "data: [DONE]\n\n",
      ]),
    );

    const events = await collect(
      new OpenAIProvider({
        id: "openai",
        apiKey: "test",
        baseURL: "https://api.openai.com/v1",
      }).stream(request),
    );

    expect(events).toContainEqual({ type: "text-delta", text: "Hi" });
    expect(events).toContainEqual({
      type: "usage",
      usage: { input: 4, output: 2, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
    });
    expect(events.at(-1)).toEqual({ type: "finish", reason: "stop" });
  });

  it("streams tool calls and converts assistant/tool messages", async () => {
    const fetchMock = stubFetch(
      sseResponse([
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"read","arguments":"{\\"path\\":"}}]}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"a.ts\\"}"}}]}}]}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
        "data: [DONE]\n\n",
      ]),
    );

    const events = await collect(
      new OpenAIProvider({
        id: "openai",
        apiKey: "test",
        baseURL: "https://api.openai.com/v1",
      }).stream({
        ...request,
        messages: [
          { role: "user", content: "read it" },
          {
            role: "assistant",
            content: "",
            toolCalls: [{ id: "call_0", name: "glob", input: { pattern: "*" } }],
          },
          { role: "tool", content: "src/a.ts", toolCallID: "call_0", name: "glob" },
        ],
      }),
    );

    expect(events).toContainEqual({ type: "tool-call-start", callID: "call_1", tool: "read" });
    expect(events).toContainEqual({
      type: "tool-call-delta",
      callID: "call_1",
      argsDelta: '{"path":',
    });
    expect(events).toContainEqual({ type: "tool-call-end", callID: "call_1" });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(init.body)) as {
      messages: Array<Record<string, unknown>>;
    };
    expect(body.messages[1]).toMatchObject({ role: "assistant" });
    const toolCalls = body.messages[1]?.tool_calls;
    expect(Array.isArray(toolCalls) ? toolCalls.length : 0).toBe(1);
    expect(body.messages[2]).toMatchObject({ role: "tool", tool_call_id: "call_0" });
  });

  it("emits arguments that arrive before the tool name", async () => {
    stubFetch(
      sseResponse([
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"path\\":"}}]}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"read"}}]}}]}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
        "data: [DONE]\n\n",
      ]),
    );

    const events = await collect(
      new OpenAIProvider({
        id: "openai",
        apiKey: "test",
        baseURL: "https://api.openai.com/v1",
      }).stream(request),
    );

    expect(events).toContainEqual({ type: "tool-call-start", callID: "call_1", tool: "read" });
    expect(events).toContainEqual({
      type: "tool-call-delta",
      callID: "call_1",
      argsDelta: '{"path":',
    });
    expect(events).toContainEqual({ type: "tool-call-end", callID: "call_1" });
  });

  it("throws a provider error on HTTP failure", async () => {
    stubFetch(new Response("unauthorized", { status: 401 }));
    await expect(
      collect(
        new OpenAIProvider({
          id: "openai",
          apiKey: "test",
          baseURL: "https://api.openai.com/v1",
        }).stream(request),
      ),
    ).rejects.toMatchObject({ code: "provider_error" });
  });

  it("lists models", async () => {
    stubFetch(
      new Response(JSON.stringify({ data: [{ id: "gpt-5" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const models = await new OpenAIProvider({
      id: "openai",
      apiKey: "test",
      baseURL: "https://api.openai.com/v1",
    }).listModels();
    expect(models.map((model) => model.id)).toEqual(["gpt-5"]);
  });
});
