import type { ToolDefinition, ToolOutput } from "@harness/shared";
import { HarnessError } from "@harness/shared";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { z } from "zod";

export type McpServerConfig =
  | {
      command: string;
      args?: string[];
      env?: Record<string, string>;
    }
  | {
      url: string;
      headers?: Record<string, string>;
    };

export interface McpConnection {
  name: string;
  client: Client;
  tools: Array<ToolDefinition<Record<string, unknown>>>;
  close: () => Promise<void>;
}

interface McpContent {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
}

interface McpTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
  };
}

export function mcpResultToOutput(result: {
  content?: McpContent[];
  isError?: boolean;
}): ToolOutput {
  const content = Array.isArray(result.content) ? result.content : [];
  const text = content
    .filter((entry) => entry.type === "text" && typeof entry.text === "string")
    .map((entry) => entry.text)
    .join("\n");

  if (result.isError) {
    return { kind: "text", text: text || "MCP tool reported an error." };
  }

  const image = content.find((entry) => entry.type === "image" && entry.data);
  if (image?.data) {
    return {
      kind: "image",
      mime: image.mimeType ?? "image/png",
      data: image.data,
    };
  }

  if (text.length > 0) return { kind: "text", text };
  return { kind: "json", value: result };
}

export function toolFromMcpTool(
  serverName: string,
  client: Client,
  tool: McpTool,
): ToolDefinition<Record<string, unknown>> {
  const input = z.record(z.string(), z.unknown());
  const readOnly = tool.annotations?.readOnlyHint === true;

  return {
    id: `mcp_${serverName}_${tool.name}`,
    description: tool.description ?? `MCP tool ${tool.name} from ${serverName}`,
    input,
    parametersOverride: tool.inputSchema,
    readOnly,
    parallelizable: readOnly,
    defaultDecision: readOnly ? "allow" : "ask",
    timeoutMs: 120_000,
    execute: async (args) => {
      const result = await client.callTool({
        name: tool.name,
        arguments: args,
      });
      return mcpResultToOutput(result as unknown as { content?: McpContent[]; isError?: boolean });
    },
  };
}

export async function connectMcpServer(
  name: string,
  config: McpServerConfig,
  options: { logger?: { warn: (payload: unknown, message?: string) => void } } = {},
): Promise<McpConnection> {
  const client = new Client({ name: "harness", version: "0.0.0" });
  const transport =
    "url" in config
      ? new StreamableHTTPClientTransport(
          new URL(config.url),
          config.headers ? { requestInit: { headers: config.headers } } : undefined,
        )
      : new StdioClientTransport({
          command: config.command,
          args: config.args ?? [],
          env: { ...process.env, ...config.env } as Record<string, string>,
          stderr: "pipe",
        });

  try {
    await client.connect(transport);
    const listed = await client.listTools();
    const tools = listed.tools.map((tool) => toolFromMcpTool(name, client, tool as McpTool));
    return {
      name,
      client,
      tools,
      close: async () => {
        await client.close();
      },
    };
  } catch (error) {
    await client.close().catch(() => undefined);
    options.logger?.warn({ err: error }, `failed to connect MCP server ${name}`);
    throw new HarnessError("provider_error", `MCP server ${name} failed: ${String(error)}`, {
      cause: error,
      recoverable: true,
    });
  }
}

export async function registerMcpTools(
  registry: { register: (tool: ToolDefinition<unknown>) => void },
  servers: Record<string, unknown>,
  options: {
    env?: NodeJS.ProcessEnv;
    logger?: { warn: (payload: unknown, message?: string) => void };
  } = {},
): Promise<McpConnection[]> {
  const connections: McpConnection[] = [];

  for (const [name, raw] of Object.entries(servers)) {
    const config = raw as McpServerConfig;
    try {
      const connection = await connectMcpServer(name, config, options);
      for (const tool of connection.tools) registry.register(tool as ToolDefinition<unknown>);
      connections.push(connection);
    } catch {
      // connectMcpServer logs and throws; one bad server must not break the rest.
    }
  }

  return connections;
}
