import { configJsonSchema, loadConfig, resolveGlobalConfigPath } from "@kiln/shared";
import type { Command } from "commander";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getConfigValue(config: unknown, path: string): unknown {
  return path
    .split(".")
    .filter((part) => part.length > 0)
    .reduce<unknown>((current, part) => (isRecord(current) ? current[part] : undefined), config);
}

export function registerConfigCommand(program: Command): void {
  const config = program.command("config").description("Inspect kiln configuration");

  config
    .command("path")
    .description("Print the global configuration path")
    .action(() => {
      process.stdout.write(`${resolveGlobalConfigPath()}\n`);
    });

  config
    .command("schema")
    .description("Print the configuration JSON schema")
    .action(() => {
      process.stdout.write(`${JSON.stringify(configJsonSchema, null, 2)}\n`);
    });

  config
    .command("get <key>")
    .description("Read a configuration value by dotted path")
    .action(async (key: string) => {
      const loaded = await loadConfig();
      const value = getConfigValue(loaded.config, key);
      process.stdout.write(`${value === undefined ? "undefined" : JSON.stringify(value)}\n`);
    });
}
