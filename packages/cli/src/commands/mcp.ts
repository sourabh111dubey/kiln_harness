import { createDefaultToolRegistry } from "@kilncraft/core";
import { startMcpStdioServer } from "@kilncraft/mcp";
import { loadConfig } from "@kilncraft/shared";
import type { Command } from "commander";

export function registerMcpCommand(program: Command): void {
  const mcp = program.command("mcp").description("Model Context Protocol integration");

  mcp
    .command("list")
    .description("List configured MCP servers")
    .action(async () => {
      const loaded = await loadConfig();
      const servers = Object.entries(loaded.config.mcp.servers);
      if (servers.length === 0) {
        process.stdout.write("(no MCP servers configured)\n");
        return;
      }
      for (const [name, config] of servers) {
        const target =
          typeof config === "object" && config !== null && "url" in config
            ? String((config as { url: unknown }).url)
            : `${String((config as { command?: unknown }).command ?? "?")} ${((config as { args?: unknown }).args as string[] | undefined)?.join(" ") ?? ""}`;
        process.stdout.write(`${name}\t${target.trim()}\n`);
      }
    });

  mcp
    .command("serve")
    .description("Expose kilncraft tools over MCP stdio")
    .option("--allow-destructive", "Expose mutating tools (requires trust)")
    .action(async (options: { allowDestructive?: boolean }) => {
      const tools = createDefaultToolRegistry();
      process.stderr.write("kilncraft MCP server ready on stdio\n");
      await startMcpStdioServer(tools.list(), {
        allowDestructive: options.allowDestructive === true,
      });
    });
}
