import type { StreamRequest } from "@harness/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnthropicProvider } from "../src/provider/anthropic";
import { collect, sseResponse } from "./helpers";

const request: StreamRequest = {
  model: "claude-sonnet-4-5",
  system: "You are a test.",
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

describe("anthropic provider", () => {
  it("streams text and usage", async () => {
    stubFetch(
      sseResponse([
        'data: {"type":"message_start","message":{"usage":{"input_tokens":10}}}\n\n',
        'data: {"type":"content_block_start","index":0,"content_block":{"type":"text"}}\n\n',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}\n\n',
        'data: {"type":"content_block_stop","index":0}\n\n',
        'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}\n\n',
        'data: {"type":"message_stop"}\n\n',
      ]),
    );

    const events = await collect(new AnthropicProvider({ apiKey: "test" }).stream(request));

    expect(events).toContainEqual({ type: "text-delta", text: "Hello" });
    expect(events).toContainEqual({
      type: "usage",
      usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
    });
    expect(events.at(-1)).toEqual({ type: "finish", reason: "end_turn" });
  });

  it("streams tool calls and converts assistant/tool messages", async () => {
    const fetchMock = stubFetch(
      sseResponse([
        'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"call_1","name":"read"}}\n\n',
        'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\":"}}\n\n',
        'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"\\"a.ts\\"}"}}\n\n',
        'data: {"type":"content_block_stop","index":1}\n\n',
        'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":7}}\n\n',
        'data: {"type":"message_stop"}\n\n',
      ]),
    );

    const events = await collect(
      new AnthropicProvider({ apiKey: "test" }).stream({
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
      system: string;
      messages: Array<{ role: string; content: unknown }>;
    };
    expect(body.system).toBe("You are a test.");
    expect(body.messages[1]).toMatchObject({ role: "assistant" });
    expect(body.messages[2]).toMatchObject({ role: "user" });
  });

  it("throws a provider error on HTTP failure", async () => {
    stubFetch(new Response("unauthorized", { status: 401 }));
    await expect(
      collect(new AnthropicProvider({ apiKey: "test" }).stream(request)),
    ).rejects.toMatchObject({ code: "provider_error" });
  });

  it("lists models", async () => {
    stubFetch(
      new Response(JSON.stringify({ data: [{ id: "claude-sonnet-4-5" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const models = await new AnthropicProvider({ apiKey: "test" }).listModels();
    expect(models.map((model) => model.id)).toEqual(["claude-sonnet-4-5"]);
  });
});
