import type { ToolDefinition, ToolOutput } from "@kilncraft/shared";
import { KilncraftError } from "@kilncraft/shared";
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

  if (text.length > 0) return { kind: "text", text };

  const image = content.find((entry) => entry.type === "image" && entry.data);
  if (image?.data) {
    return {
      kind: "image",
      mime: image.mimeType ?? "image/png",
      data: image.data,
    };
  }

  return { kind: "json", value: result };
}

export function toolFromMcpTool(
  serverName: string,
  client: Client,
  tool: McpTool,
): ToolDefinition<Record<string, unknown>> {
  const input = z.record(z.string(), z.unknown());

  return {
    id: `mcp_${serverName}_${tool.name}`,
    description: `${tool.description ?? `MCP tool ${tool.name} from ${serverName}`}${tool.annotations?.readOnlyHint ? " (read-only)" : ""}`,
    input,
    parametersOverride: tool.inputSchema,
    readOnly: false,
    parallelizable: false,
    defaultDecision: "ask",
    timeoutMs: 120_000,
    execute: async (args, context) => {
      const result = await client.callTool(
        {
          name: tool.name,
          arguments: args,
        },
        undefined,
        { signal: context.signal, timeout: 120_000 },
      );
      return mcpResultToOutput(result as unknown as { content?: McpContent[]; isError?: boolean });
    },
  };
}

export async function connectMcpServer(
  name: string,
  config: McpServerConfig,
  options: { logger?: { warn: (payload: unknown, message?: string) => void } } = {},
): Promise<McpConnection> {
  const client = new Client({ name: "kilncraft", version: "0.0.0" });
  const env: Record<string, string> = {};
  for (const key of [
    "PATH",
    "HOME",
    "TMPDIR",
    "LANG",
    "LC_ALL",
    "TERM",
    "USER",
    "SHELL",
    "NODE_PATH",
  ]) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  Object.assign(env, "command" in config ? (config.env ?? {}) : {});

  const transport =
    "url" in config
      ? new StreamableHTTPClientTransport(
          new URL(config.url),
          config.headers ? { requestInit: { headers: config.headers } } : undefined,
        )
      : new StdioClientTransport({
          command: config.command,
          args: config.args ?? [],
          env,
          stderr: "pipe",
        });

  try {
    await client.connect(transport);
    const stderr = (transport as { stderr?: { resume?: () => void } }).stderr;
    stderr?.resume?.();
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
    throw new KilncraftError("provider_error", `MCP server ${name} failed: ${String(error)}`, {
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
