import { execFile } from "node:child_process";
import { access, constants } from "node:fs/promises";
import { arch, platform, release } from "node:os";
import { styleText } from "node:util";
import { loadConfig, resolveGlobalConfigPath } from "@kiln/shared";
import type { Command } from "commander";

export type CheckStatus = "ok" | "warn" | "fail";

export interface DoctorCheck {
  name: string;
  status: CheckStatus;
  detail: string;
}

export interface DoctorResult {
  ok: boolean;
  checks: DoctorCheck[];
}

export interface DoctorOptions {
  cwd?: string;
  globalPath?: string;
  env?: NodeJS.ProcessEnv;
}

function majorVersion(version: string): number {
  return Number.parseInt(version.split(".")[0] ?? "0", 10);
}

async function commandVersion(
  command: string,
  args: string[] = ["--version"],
): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: 2_000 }, (error, stdout) => {
      if (error) {
        resolve(null);
        return;
      }
      resolve(stdout.trim().split("\n")[0] ?? null);
    });
  });
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function sandboxCheck(): Promise<DoctorCheck> {
  if (process.platform === "linux") {
    const version = await commandVersion("bwrap", ["--version"]);
    const cleanVersion = version?.replace(/^bubblewrap\s+/, "") ?? null;
    return cleanVersion
      ? { name: "Sandbox", status: "ok", detail: `bubblewrap ${cleanVersion}` }
      : {
          name: "Sandbox",
          status: "warn",
          detail: "bubblewrap not found; install it for shell sandboxing",
        };
  }
  if (process.platform === "darwin") {
    const exists = await pathExists("/usr/bin/sandbox-exec");
    return exists
      ? { name: "Sandbox", status: "ok", detail: "sandbox-exec available" }
      : { name: "Sandbox", status: "warn", detail: "sandbox-exec not found" };
  }
  return {
    name: "Sandbox",
    status: "warn",
    detail: `${process.platform}: native sandbox unavailable; use Docker or WSL2`,
  };
}

export async function runDoctor(options: DoctorOptions = {}): Promise<DoctorResult> {
  const checks: DoctorCheck[] = [];
  const nodeMajor = majorVersion(process.versions.node);
  checks.push(
    nodeMajor >= 24
      ? { name: "Node.js", status: "ok", detail: `${process.versions.node} (>= 24)` }
      : {
          name: "Node.js",
          status: "fail",
          detail: `${process.versions.node}; kiln requires Node >= 24`,
        },
  );

  checks.push({
    name: "Platform",
    status: "ok",
    detail: `${platform()} ${arch()} ${release()}`,
  });

  const env = options.env ?? process.env;
  const globalPath = options.globalPath ?? resolveGlobalConfigPath(env);
  let configDetail = `${globalPath} (using defaults)`;
  let configStatus: CheckStatus = "warn";
  try {
    const loaded = await loadConfig({ cwd: options.cwd, globalPath, env });
    configStatus = loaded.sources.length > 0 ? "ok" : "warn";
    configDetail =
      loaded.sources.length > 0
        ? `loaded ${loaded.sources.length} file(s)`
        : `${globalPath} not found (using defaults)`;
  } catch (error) {
    configStatus = "fail";
    configDetail = error instanceof Error ? error.message : String(error);
  }
  checks.push({ name: "Config", status: configStatus, detail: configDetail });

  const git = await commandVersion("git");
  checks.push(
    git
      ? { name: "Git", status: "ok", detail: git }
      : { name: "Git", status: "warn", detail: "git not found on PATH" },
  );

  const ripgrep = await commandVersion("rg");
  checks.push(
    ripgrep
      ? { name: "Ripgrep", status: "ok", detail: ripgrep }
      : { name: "Ripgrep", status: "warn", detail: "rg not found; grep will use a fallback" },
  );

  checks.push(await sandboxCheck());

  const telemetry = env.KILN_TELEMETRY;
  checks.push(
    telemetry
      ? {
          name: "Telemetry",
          status: "warn",
          detail: `enabled by KILN_TELEMETRY=${telemetry}`,
        }
      : { name: "Telemetry", status: "ok", detail: "disabled (opt-in)" },
  );

  return { ok: !checks.some((check) => check.status === "fail"), checks };
}

function symbolFor(status: CheckStatus): string {
  if (status === "ok") return "✓";
  if (status === "warn") return "!";
  return "✗";
}

function colorFor(status: CheckStatus): "green" | "yellow" | "red" {
  if (status === "ok") return "green";
  if (status === "warn") return "yellow";
  return "red";
}

export function formatDoctor(result: DoctorResult): string {
  const useColor = process.env.NO_COLOR === undefined && process.env.TERM !== "dumb";
  return result.checks
    .map((check) => {
      const symbol = useColor
        ? styleText(colorFor(check.status), symbolFor(check.status))
        : symbolFor(check.status);
      return `${symbol} ${check.name}: ${check.detail}`;
    })
    .join("\n");
}

export function registerDoctorCommand(program: Command): void {
  program
    .command("doctor")
    .description("Check the local environment and configuration")
    .action(async () => {
      const result = await runDoctor();
      process.stdout.write(`${formatDoctor(result)}\n`);
      if (!result.ok) process.exitCode = 1;
    });
}
