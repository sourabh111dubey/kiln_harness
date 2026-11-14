import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { type ParseError, parse } from "jsonc-parser";
import { z } from "zod";
import { KilnError, toKilnError } from "./errors";
import { permissionModeSchema, permissionRuleSchema } from "./permission";

export const permissionPolicySchema = z
  .object({
    default: permissionModeSchema.default("default"),
    rules: z.array(permissionRuleSchema).default([]),
  })
  .default({ default: "default", rules: [] });

export type PermissionPolicy = z.infer<typeof permissionPolicySchema>;

export const kilnConfigSchema = z
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

export type KilnConfig = z.infer<typeof kilnConfigSchema>;

export const defaultConfig: KilnConfig = kilnConfigSchema.parse({});

export const configJsonSchema = z.toJSONSchema(kilnConfigSchema, {
  target: "draft-2020-12",
}) as Record<string, unknown>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const PROJECT_CONFIG_KEYS = [
  "$schema",
  "model",
  "smallModel",
  "agent",
  "tools",
  "skills",
  "instructions",
  "ui",
] as const;

function sanitizeProjectConfig(value: unknown): unknown {
  if (!isPlainObject(value)) return value;
  const result: Record<string, unknown> = {};
  for (const key of PROJECT_CONFIG_KEYS) {
    if (key in value) result[key] = value[key];
  }
  return result;
}

export function deepMerge(base: unknown, override: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(override)) return override;
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
    result[key] = key in base ? deepMerge(base[key], value) : value;
  }
  return result;
}

export function mergeConfigs(...sources: unknown[]): unknown {
  return sources.reduce<unknown>(
    (merged, source) =>
      source === undefined || source === null ? merged : deepMerge(merged, source),
    {},
  );
}

export function resolveGlobalConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.KILN_CONFIG_DIR
    ? join(env.KILN_CONFIG_DIR, "config.json")
    : join(homedir(), ".kiln", "config.json");
}

export function resolveProjectConfigPath(cwd: string): string {
  return join(cwd, ".kiln", "config.json");
}

async function readJsoncFile(path: string): Promise<unknown | undefined> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw toKilnError(error, "io_error");
  }

  const parseErrors: ParseError[] = [];
  const value: unknown = parse(text, parseErrors, {
    allowTrailingComma: true,
    disallowComments: false,
  });

  if (parseErrors.length > 0) {
    const first = parseErrors[0];
    throw new KilnError("invalid_config", `Invalid JSON in ${path}`, {
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

  if (env.KILN_MODEL) overrides.model = env.KILN_MODEL;
  if (env.KILN_SMALL_MODEL) overrides.smallModel = env.KILN_SMALL_MODEL;
  if (env.KILN_AGENT) overrides.agent = env.KILN_AGENT;
  if (env.KILN_PERMISSION_MODE) {
    overrides.permissions = { default: env.KILN_PERMISSION_MODE };
  }
  if (env.KILN_TELEMETRY) {
    overrides.telemetry = {
      enabled: ["1", "true", "yes", "on"].includes(env.KILN_TELEMETRY.toLowerCase()),
    };
  }
  return overrides;
}

export interface LoadedConfig {
  config: KilnConfig;
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
    const safeValue = path === projectPath ? sanitizeProjectConfig(value) : value;
    merged = deepMerge(merged, safeValue);
    sources.push(path);
  }

  merged = deepMerge(merged, envOverrides(env));

  const parsed = kilnConfigSchema.safeParse(merged);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
      .join("; ");
    throw new KilnError("invalid_config", `Invalid kiln configuration: ${issues}`, {
      details: { issues: parsed.error.issues },
      hint: `Check ${projectPath} and ${globalPath}.`,
    });
  }

  return { config: parsed.data, path: projectPath, sources };
}
