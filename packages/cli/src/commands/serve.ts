import { startServer } from "@kiln/server";
import type { Command } from "commander";

export function registerServeCommand(program: Command): void {
  program
    .command("serve")
    .description("Start the kiln HTTP/WebSocket daemon")
    .option("--port <n>", "Port to listen on", "4096")
    .option("--host <host>", "Host to bind", "127.0.0.1")
    .action(async (options: { port?: string; host?: string }) => {
      const port = Number.parseInt(options.port ?? "4096", 10);
      if (!Number.isFinite(port) || port < 0 || port > 65_535) {
        process.stderr.write("Invalid port.\n");
        process.exitCode = 2;
        return;
      }

      const running = await startServer({
        port,
        hostname: options.host ?? "127.0.0.1",
      });

      process.stdout.write(`kiln serving at ${running.url}\n`);

      const shutdown = async () => {
        await running.close();
        process.exit(0);
      };

      process.on("SIGINT", () => void shutdown());
      process.on("SIGTERM", () => void shutdown());
    });
}
