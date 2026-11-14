import { type ChildProcess, spawn } from "node:child_process";
import type { ToolDefinition } from "@harness/shared";
import { z } from "zod";
import { assertInsideWorkspace, assertRealInside, resolveWorkspacePath } from "./common";

const bashInput = z.object({
  command: z.string().min(1).describe("Shell command to execute"),
  cwd: z.string().optional().describe("Working directory (defaults to the workspace root)"),
  timeout: z.number().int().positive().max(600_000).optional().describe("Timeout in milliseconds"),
});

export type BashInput = z.infer<typeof bashInput>;

const OUTPUT_LIMIT = 30_000;

const ALLOWED_ENV = new Set([
  "PATH",
  "HOME",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "TERM",
  "USER",
  "LOGNAME",
  "SHELL",
  "PWD",
  "SHLVL",
  "NODE_PATH",
]);

function sanitizedEnvironment(): NodeJS.ProcessEnv {
  const extra = (process.env.HARNESS_PASS_ENV ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  const environment: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (!ALLOWED_ENV.has(key) && !extra.includes(key)) continue;
    environment[key] = value;
  }
  return environment;
}

function killProcessTree(child: ChildProcess): void {
  if (child.pid === undefined) return;
  const signal = process.platform === "win32" ? undefined : -child.pid;
  try {
    if (signal !== undefined) process.kill(signal, "SIGTERM");
    else child.kill("SIGTERM");
  } catch {
    // The process may already have exited.
  }
  setTimeout(() => {
    try {
      if (signal !== undefined) process.kill(signal, "SIGKILL");
      else child.kill("SIGKILL");
    } catch {
      // Already gone.
    }
  }, 1_000).unref();
}

export const bashTool: ToolDefinition<BashInput> = {
  id: "bash",
  description:
    "Run a shell command in the workspace. Output is streamed and truncated at 30k characters per stream.",
  input: bashInput,
  readOnly: false,
  parallelizable: false,
  defaultDecision: "ask",
  timeoutMs: 600_000,
  async execute(input, context) {
    const cwd = input.cwd ? resolveWorkspacePath(context.cwd, input.cwd) : context.cwd;
    assertInsideWorkspace(context.cwd, cwd);
    await assertRealInside(context.workspaceRoot || context.cwd, cwd);

    const shell =
      process.platform === "win32"
        ? (process.env.COMSPEC ?? "cmd.exe")
        : (process.env.SHELL ?? "/bin/bash");
    const fallbackArgs =
      process.platform === "win32" ? ["/c", input.command] : ["-c", input.command];
    const wrapped = context.sandbox?.wrap(input.command, { cwd });
    const command = wrapped?.command ?? shell;
    const args = wrapped?.args ?? fallbackArgs;

    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd,
        env: sanitizedEnvironment(),
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      let stdoutTruncated = false;
      let stderrTruncated = false;

      child.stdout?.on("data", (chunk: Buffer) => {
        if (stdout.length >= OUTPUT_LIMIT) {
          stdoutTruncated = true;
          return;
        }
        stdout += chunk.toString("utf8");
      });

      child.stderr?.on("data", (chunk: Buffer) => {
        if (stderr.length >= OUTPUT_LIMIT) {
          stderrTruncated = true;
          return;
        }
        stderr += chunk.toString("utf8");
      });

      let timedOut = false;
      const timeoutMs = input.timeout ?? 120_000;
      const timer = setTimeout(() => {
        timedOut = true;
        killProcessTree(child);
      }, timeoutMs);

      const onAbort = () => killProcessTree(child);
      context.signal.addEventListener("abort", onAbort, { once: true });

      child.on("error", (error) => {
        clearTimeout(timer);
        context.signal.removeEventListener("abort", onAbort);
        reject(error);
      });

      child.on("close", (code, signal) => {
        clearTimeout(timer);
        context.signal.removeEventListener("abort", onAbort);

        if (timedOut) {
          stderr += `\n[command timed out after ${timeoutMs}ms]`;
        }

        resolve({
          kind: "terminal",
          stdout: stdoutTruncated ? `${stdout}\n[stdout truncated]` : stdout,
          stderr: stderrTruncated ? `${stderr}\n[stderr truncated]` : stderr,
          exitCode: code ?? (signal ? 1 : 0),
        });
      });
    });
  },
};
