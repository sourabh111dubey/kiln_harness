import { type PermissionMode, toHarnessError } from "@harness/shared";
import type { Command } from "commander";
import { runPrompt } from "../run-prompt";

const PERMISSION_MODES: PermissionMode[] = [
  "default",
  "acceptEdits",
  "plan",
  "bypassPermissions",
  "custom",
];

export function registerRunCommand(program: Command): void {
  const run = program
    .command("run [prompt...]")
    .description(
      "Run a prompt non-interactively (headless runs cannot prompt; use --permission-mode acceptEdits to allow edits)",
    )
    .option("--print", "Print the final result and exit")
    .option("--output-format <format>", "text | json", "text")
    .option("--session <id>", "Resume an existing session")
    .option("--continue", "Continue the most recent session in this directory");

  run.action(async (prompt: string[] | undefined) => {
    const options = run.optsWithGlobals();
    const text = prompt?.join(" ").trim();

    if (!text) {
      process.stderr.write("No prompt provided.\n");
      process.exitCode = 2;
      return;
    }

    const permissionMode = options.permissionMode as PermissionMode | undefined;
    if (permissionMode && !PERMISSION_MODES.includes(permissionMode)) {
      process.stderr.write(
        `Invalid permission mode "${permissionMode}". Expected one of: ${PERMISSION_MODES.join(", ")}.\n`,
      );
      process.exitCode = 2;
      return;
    }

    try {
      const result = await runPrompt({
        prompt: text,
        cwd: options.cwd,
        model: options.model,
        permissionMode,
        verbose: options.verbose === true,
        sessionID: options.session,
        continueSession: options.continue === true,
        agent: options.agent,
      });

      if (options.json === true || options.outputFormat === "json") {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      } else {
        process.stdout.write(`${result.text}\n`);
      }
    } catch (error) {
      const harnessError = toHarnessError(error);
      process.stderr.write(`harness: ${harnessError.message}\n`);
      if (harnessError.hint) {
        process.stderr.write(`hint: ${harnessError.hint}\n`);
      }
      process.exitCode = 1;
    }
  });
}
