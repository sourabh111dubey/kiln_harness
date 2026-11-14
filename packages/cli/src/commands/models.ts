import { createDefaultProviderRegistry, listKnownModels } from "@harness/core";
import { loadConfig } from "@harness/shared";
import type { Command } from "commander";

export function registerModelsCommand(program: Command): void {
  const models = program.command("models").description("Inspect available models");

  models
    .command("list")
    .description("List known models and configured providers")
    .action(() => {
      const registry = createDefaultProviderRegistry();
      const configured = new Set(registry.list().map((provider) => provider.id));

      for (const model of listKnownModels()) {
        const marker = configured.has(model.provider) ? "*" : " ";
        process.stdout.write(
          `${marker} ${model.provider}/${model.id}\t${model.contextWindow} ctx\t${model.name}\n`,
        );
      }

      process.stdout.write(`\nConfigured providers: ${[...configured].join(", ") || "(none)"}\n`);
    });

  models
    .command("default")
    .description("Print the default model from config")
    .action(async () => {
      const loaded = await loadConfig();
      process.stdout.write(`${loaded.config.model ?? "undefined"}\n`);
    });
}
