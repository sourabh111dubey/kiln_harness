import type { ToolDefinition, ToolOutput } from "@harness/shared";
import { createLogger } from "@harness/shared";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

type McpContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export function mcpContentFromOutput(output: ToolOutput): { content: McpContent[] } {
  switch (output.kind) {
    case "text":
      return { content: [{ type: "text", text: output.text }] };
    case "json":
    case "structured":
      return { content: [{ type: "text", text: JSON.stringify(output.value, null, 2) }] };
    case "diff":
      return { content: [{ type: "text", text: output.diff || "(no diff)" }] };
    case "terminal": {
      const text = [output.stdout, output.stderr, `exit ${output.exitCode}`]
        .filter((part) => part.length > 0)
        .join("\n");
      return { content: [{ type: "text", text }] };
    }
    case "image":
      return {
        content: [{ type: "image", data: output.data, mimeType: output.mime }],
      };
  }
}

export function createMcpServer(
  tools: ToolDefinition<unknown>[],
  options: { allowDestructive?: boolean } = {},
): McpServer {
  const server = new McpServer({ name: "harness", version: "0.0.0" });
  const logger = createLogger({ level: "silent" });
  const exposed = options.allowDestructive ? tools : tools.filter((tool) => tool.readOnly);

  for (const tool of exposed) {
    server.registerTool(
      tool.id,
      {
        description: tool.description,
        inputSchema: tool.input,
      },
      async (args: unknown) => {
        const output = await tool.execute(args, {
          sessionID: "mcp",
          cwd: process.cwd(),
          workspaceRoot: process.cwd(),
          signal: new AbortController().signal,
          logger,
          state: {},
        });
        return mcpContentFromOutput(output);
      },
    );
  }

  return server;
}

export async function startMcpStdioServer(
  tools: ToolDefinition<unknown>[] = [],
  options: { allowDestructive?: boolean } = {},
): Promise<McpServer> {
  const server = createMcpServer(tools, options);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  return server;
}

export async function createMcpHttpHandler(
  tools: ToolDefinition<unknown>[] = [],
  options: { allowDestructive?: boolean } = {},
): Promise<(request: Request) => Promise<Response>> {
  const server = createMcpServer(tools, options);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  await server.connect(transport);
  return (request: Request) => transport.handleRequest(request);
}
