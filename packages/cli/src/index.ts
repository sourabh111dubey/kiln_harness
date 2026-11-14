#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderKilnTui } from "@kiln/tui";
import { Command } from "commander";
import { registerConfigCommand } from "./commands/config";
import { registerDoctorCommand } from "./commands/doctor";
import { registerMcpCommand } from "./commands/mcp";
import { registerModelsCommand } from "./commands/models";
import { registerRunCommand } from "./commands/run";
import { registerServeCommand } from "./commands/serve";
import { registerSessionCommands } from "./commands/session";
import { readVersion } from "./version";

export function createProgram(): Command {
  const program = new Command();

  program
    .name("kiln")
    .description("A production coding agent kiln")
    .version(readVersion(), "-v, --version")
    .argument("[prompt...]", "Initial prompt for the interactive session")
    .option("--model <model>", "Model to use, as provider/model")
    .option("--cwd <dir>", "Working directory")
    .option("--agent <id>", "Agent preset")
    .option("--permission-mode <mode>", "default | acceptEdits | plan | bypassPermissions | custom")
    .option("--standalone", "Run the daemon in-process instead of attaching")
    .option("--json", "Emit machine-readable output")
    .option("--verbose", "Enable debug logging");

  registerRunCommand(program);
  registerModelsCommand(program);
  registerConfigCommand(program);
  registerDoctorCommand(program);
  registerSessionCommands(program);
  registerServeCommand(program);
  registerMcpCommand(program);

  program.action((prompt: string[] | undefined) => {
    const options = program.opts();
    if (options.json === true || !process.stdout.isTTY || !process.stdin.isTTY) {
      program.help();
      return;
    }

    try {
      renderKilnTui({
        cwd: options.cwd,
        model: options.model,
        permissionMode: options.permissionMode,
        agent: options.agent,
        initialPrompt: prompt?.join(" ").trim() || undefined,
      });
    } catch (error) {
      process.stderr.write(
        `kiln: failed to start TUI: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    }
  });

  return program;
}

export async function main(argv: string[] = process.argv): Promise<void> {
  const program = createProgram();
  await program.parseAsync(argv);
}

function isDirectInvocation(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(entry));
  } catch {
    return false;
  }
}

if (isDirectInvocation()) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`kiln: ${message}\n`);
    process.exitCode = 1;
  });
}
