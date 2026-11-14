import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { type ParseError, parse } from "jsonc-parser";
import { z } from "zod";
import { HarnessError, toHarnessError } from "./errors";
import { permissionModeSchema, permissionRuleSchema } from "./permission";

export const permissionPolicySchema = z
  .object({
    default: permissionModeSchema.default("default"),
    rules: z.array(permissionRuleSchema).default([]),
  })
  .default({ default: "default", rules: [] });

export type PermissionPolicy = z.infer<typeof permissionPolicySchema>;

export const harnessConfigSchema = z
  .object({
    $schema: z.string().optional(),
    model: z.string().optional(),
    smallModel: z.string().optional(),
    agent: z.string().default("build"),
    permissions: permissionPolicySchema,
    providers: z.record(z.string(), z.unknown()).default({}),
    mcp: z
      .object({
        servers: z.record(z.string(), z.unknown()).default({}),
      })
      .default({ servers: {} }),
    tools: z.record(z.string(), z.unknown()).default({}),
    lsp: z
      .object({
        servers: z.record(z.string(), z.unknown()).default({}),
      })
      .default({ servers: {} }),
    skills: z
      .object({
        paths: z.array(z.string()).default([]),
      })
      .default({ paths: [] }),
    plugins: z.array(z.string()).default([]),
    instructions: z.array(z.string()).default(["AGENTS.md"]),
    sandbox: z
      .object({
        enabled: z.boolean().default(true),
        network: z.boolean().default(false),
      })
      .default({ enabled: true, network: false }),
    telemetry: z
      .object({
        enabled: z.boolean().default(false),
      })
      .default({ enabled: false }),
    ui: z
      .object({
        theme: z.string().default("default"),
      })
      .default({ theme: "default" }),
  })
  .strict();

export type HarnessConfig = z.infer<typeof harnessConfigSchema>;

export const defaultConfig: HarnessConfig = harnessConfigSchema.parse({});

export const configJsonSchema = z.toJSONSchema(harnessConfigSchema, {
  target: "draft-2020-12",
}) as Record<string, unknown>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function deepMerge(base: unknown, override: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(override)) return override;
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    result[key] = key in base ? deepMerge(base[key], value) : value;
  }
  return result;
}

export function mergeConfigs(...sources: unknown[]): unknown {
  return sources.reduce<unknown>((merged, source) => deepMerge(merged, source), {});
}

export function resolveGlobalConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.HARNESS_CONFIG_DIR
    ? join(env.HARNESS_CONFIG_DIR, "config.json")
    : join(homedir(), ".harness", "config.json");
}

export function resolveProjectConfigPath(cwd: string): string {
  return join(cwd, ".harness", "config.json");
}

async function readJsoncFile(path: string): Promise<unknown | undefined> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw toHarnessError(error, "io_error");
  }

  const parseErrors: ParseError[] = [];
  const value: unknown = parse(text, parseErrors, {
    allowTrailingComma: true,
    disallowComments: false,
  });

  if (parseErrors.length > 0) {
    const first = parseErrors[0];
    throw new HarnessError("invalid_config", `Invalid JSON in ${path}`, {
      details: first
        ? {
            path,
            offset: first.offset,
            length: first.length,
            error: first.error,
          }
        : { path },
      hint: "Configuration files must be valid JSONC (comments and trailing commas allowed).",
    });
  }

  return value;
}

function envOverrides(env: NodeJS.ProcessEnv): Record<string, unknown> {
  const overrides: Record<string, unknown> = {};

  if (env.HARNESS_MODEL) overrides.model = env.HARNESS_MODEL;
  if (env.HARNESS_SMALL_MODEL) overrides.smallModel = env.HARNESS_SMALL_MODEL;
  if (env.HARNESS_AGENT) overrides.agent = env.HARNESS_AGENT;
  if (env.HARNESS_PERMISSION_MODE) {
    overrides.permissions = { default: env.HARNESS_PERMISSION_MODE };
  }
  if (env.HARNESS_TELEMETRY) {
    overrides.telemetry = {
      enabled: ["1", "true", "yes", "on"].includes(env.HARNESS_TELEMETRY.toLowerCase()),
    };
  }
  return overrides;
}

export interface LoadedConfig {
  config: HarnessConfig;
  path: string;
  sources: string[];
}

export async function loadConfig(
  options: { cwd?: string; globalPath?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<LoadedConfig> {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const globalPath = options.globalPath ?? resolveGlobalConfigPath(env);
  const projectPath = resolveProjectConfigPath(cwd);

  const sources: string[] = [];
  let merged: unknown = {};

  for (const path of [globalPath, projectPath]) {
    const value = await readJsoncFile(path);
    if (value === undefined) continue;
    merged = deepMerge(merged, value);
    sources.push(path);
  }

  merged = deepMerge(merged, envOverrides(env));

  const parsed = harnessConfigSchema.safeParse(merged);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
      .join("; ");
    throw new HarnessError("invalid_config", `Invalid harness configuration: ${issues}`, {
      details: { issues: parsed.error.issues },
      hint: `Check ${projectPath} and ${globalPath}.`,
    });
  }

  return { config: parsed.data, path: projectPath, sources };
}
