import type { StreamRequest } from "@harness/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GeminiProvider } from "../src/provider/gemini";
import { collect, sseResponse } from "./helpers";

const request: StreamRequest = {
  model: "gemini-2.5-pro",
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

describe("gemini provider", () => {
  it("streams text, function calls, and usage", async () => {
    stubFetch(
      sseResponse([
        'data: {"candidates":[{"content":{"parts":[{"text":"Hi"}]}}]}\n\n',
        'data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"read","args":{"path":"a.ts"}}}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":3,"candidatesTokenCount":1}}\n\n',
      ]),
    );

    const events = await collect(new GeminiProvider({ apiKey: "test" }).stream(request));

    expect(events).toContainEqual({ type: "text-delta", text: "Hi" });
    const starts = events.filter((event) => event.type === "tool-call-start");
    expect(starts).toHaveLength(1);
    expect(events).toContainEqual({
      type: "usage",
      usage: { input: 3, output: 1, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
    });
    expect(events.at(-1)).toEqual({ type: "finish", reason: "STOP" });
  });

  it("converts assistant and tool messages to gemini contents", async () => {
    const fetchMock = stubFetch(
      sseResponse(['data: {"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}\n\n']),
    );

    await collect(
      new GeminiProvider({ apiKey: "test" }).stream({
        ...request,
        system: "system prompt",
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

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(init.body)) as {
      systemInstruction: unknown;
      contents: Array<{ role: string; parts: Array<Record<string, unknown>> }>;
    };
    expect(body.systemInstruction).toEqual({ parts: [{ text: "system prompt" }] });
    expect(body.contents[1]?.role).toBe("model");
    expect(body.contents[1]?.parts[0]).toMatchObject({
      functionCall: { name: "glob" },
    });
    expect(body.contents[2]?.parts[0]).toMatchObject({
      functionResponse: { name: "glob" },
    });
  });

  it("throws a provider error on HTTP failure", async () => {
    stubFetch(new Response("unauthorized", { status: 401 }));
    await expect(
      collect(new GeminiProvider({ apiKey: "test" }).stream(request)),
    ).rejects.toMatchObject({ code: "provider_error" });
  });

  it("lists models", async () => {
    stubFetch(
      new Response(JSON.stringify({ models: [{ name: "models/gemini-2.5-pro" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const models = await new GeminiProvider({ apiKey: "test" }).listModels();
    expect(models.map((model) => model.id)).toEqual(["gemini-2.5-pro"]);
  });
});
