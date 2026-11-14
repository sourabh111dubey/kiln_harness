import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger } from "@kiln/shared";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { afterEach, describe, expect, it } from "vitest";
import { mcpResultToOutput, toolFromMcpTool } from "../src/client";
import { createMcpServer, mcpContentFromOutput } from "../src/server";

const directories: string[] = [];

async function tempDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "kiln-mcp-"));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

const fakeClient = {
  callTool: async () => ({
    content: [{ type: "text", text: "ok" }],
  }),
} as unknown as Client;

describe("MCP conversion", () => {
  it("converts text, image, and error results", () => {
    expect(mcpResultToOutput({ content: [{ type: "text", text: "hello" }] })).toEqual({
      kind: "text",
      text: "hello",
    });
    expect(
      mcpResultToOutput({
        content: [{ type: "image", data: "abc", mimeType: "image/png" }],
      }),
    ).toEqual({ kind: "image", mime: "image/png", data: "abc" });
    expect(mcpResultToOutput({ content: [{ type: "text", text: "bad" }], isError: true })).toEqual({
      kind: "text",
      text: "bad",
    });
  });

  it("creates a namespaced tool with the MCP JSON schema", async () => {
    const cwd = await tempDir();
    const tool = toolFromMcpTool("demo", fakeClient, {
      name: "echo",
      description: "Echo text",
      inputSchema: { type: "object", properties: { text: { type: "string" } } },
      annotations: { readOnlyHint: true },
    });

    expect(tool.id).toBe("mcp_demo_echo");
    expect(tool.readOnly).toBe(false);
    expect(tool.parallelizable).toBe(false);
    expect(tool.defaultDecision).toBe("ask");
    expect(tool.description).toContain("read-only");
    expect(tool.parametersOverride).toEqual({
      type: "object",
      properties: { text: { type: "string" } },
    });

    const output = await tool.execute(
      { text: "hi" },
      {
        sessionID: "ses_test",
        cwd,
        workspaceRoot: cwd,
        signal: new AbortController().signal,
        logger: createLogger({ level: "silent" }),
        state: {},
      },
    );
    expect(output).toEqual({ kind: "text", text: "ok" });
  });

  it("converts tool output to MCP content", () => {
    expect(mcpContentFromOutput({ kind: "text", text: "hello" })).toEqual({
      content: [{ type: "text", text: "hello" }],
    });
    expect(mcpContentFromOutput({ kind: "diff", diff: "patch", files: [] })).toEqual({
      content: [{ type: "text", text: "patch" }],
    });
    expect(
      mcpContentFromOutput({ kind: "terminal", stdout: "out", stderr: "err", exitCode: 1 }),
    ).toEqual({ content: [{ type: "text", text: "out\nerr\nexit 1" }] });
    expect(mcpContentFromOutput({ kind: "image", mime: "image/png", data: "abc" })).toEqual({
      content: [{ type: "image", data: "abc", mimeType: "image/png" }],
    });
  });

  it("creates an MCP server with the provided tools", () => {
    const tool = toolFromMcpTool("demo", fakeClient, {
      name: "echo",
      inputSchema: { type: "object" },
    });
    expect(createMcpServer([tool])).toBeDefined();
  });
});
