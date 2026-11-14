import { describe, expect, it } from "vitest";
import { createMcpHttpHandler } from "../src/server";

describe("MCP HTTP transport", () => {
  it("answers an initialize request", async () => {
    const handler = await createMcpHttpHandler([]);
    const response = await handler(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "test", version: "0.0.0" },
          },
        }),
      }),
    );

    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("result");
  });
});
