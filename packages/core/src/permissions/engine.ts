import { resolve } from "node:path";
import type { PermissionDecision, PermissionMode, PermissionRule } from "@kilncraft/shared";
import { isPathInside, matchesGlob } from "../tools/common";

export interface PermissionRequest {
  tool: string;
  input: unknown;
}

export interface PermissionEngineOptions {
  mode: PermissionMode;
  cwd: string;
  rules?: PermissionRule[];
  isReadOnly?: (tool: string) => boolean;
}

const READ_ONLY_TOOLS = new Set([
  "read",
  "glob",
  "grep",
  "ls",
  "todo_write",
  "lsp_diagnostics",
  "lsp_symbols",
  "lsp_definition",
  "lsp_hover",
  "lsp_references",
  "git_status",
  "git_diff",
  "git_log",
]);

const WRITE_TOOLS = new Set([
  "write",
  "edit",
  "multi_edit",
  "apply_patch",
  "notebook_edit",
  "memory_write",
  "git_commit",
  "git_branch",
  "worktree_create",
]);

const DANGEROUS_PATTERNS = [
  /rm\s+-[rf]{1,2}\s+\/(?:\s|$)/,
  /\bmkfs(?:\.\w+)?\b/,
  /\bdd\s+if=/,
  /\bcurl\b[^|]*\|\s*(?:sh|bash)\b/,
  /\bgit\s+push\b[^\n]*--force\b/,
  /:\s*\(\s*\)\s*\{.*\}\s*;\s*:/,
  /\bchmod\s+777\s+\//,
  />\s*\/dev\/sd[a-z]/,
  /\bshutdown\b|\breboot\b/,
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getCommand(input: unknown): string {
  if (isRecord(input) && typeof input.command === "string") return input.command;
  return "";
}

export function getPath(input: unknown): string | undefined {
  if (isRecord(input) && typeof input.path === "string") return input.path;
  return undefined;
}

export function isDangerousCommand(command: string): boolean {
  return DANGEROUS_PATTERNS.some((pattern) => pattern.test(command));
}

function commandMatches(value: string, pattern: string): boolean {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`).test(value);
}

function matchesRuleInput(rule: PermissionRule, input: unknown): boolean {
  const command = getCommand(input);
  if (command.length > 0) return commandMatches(command, rule.pattern ?? "");

  const path = getPath(input);
  return path !== undefined && matchesGlob(path, rule.pattern ?? "");
}

export class PermissionEngine {
  private readonly rules: PermissionRule[];

  constructor(private readonly options: PermissionEngineOptions) {
    this.rules = [...(options.rules ?? [])];
  }

  get mode(): PermissionMode {
    return this.options.mode;
  }

  addRule(rule: PermissionRule): void {
    this.rules.push(rule);
  }

  decide(request: PermissionRequest): PermissionDecision {
    const matchingRules = this.rules.filter((rule) => {
      if (rule.tool !== "*" && rule.tool !== request.tool) return false;
      if (!rule.pattern) return true;
      return matchesRuleInput(rule, request.input);
    });

    if (matchingRules.some((rule) => rule.decision === "deny")) return "deny";
    if (matchingRules.some((rule) => rule.decision === "ask")) return "ask";
    const allow = matchingRules.find((rule) => rule.decision === "allow");
    if (allow) return "allow";

    if (this.options.mode === "bypassPermissions") return "allow";

    if (request.tool === "bash") {
      if (isDangerousCommand(getCommand(request.input))) {
        return this.options.mode === "plan" ? "deny" : "ask";
      }
    }

    const isReadOnly = this.options.isReadOnly?.(request.tool) ?? READ_ONLY_TOOLS.has(request.tool);
    if (isReadOnly) return "allow";
    if (this.options.mode === "plan") return "deny";

    if (this.options.mode === "acceptEdits" && WRITE_TOOLS.has(request.tool)) {
      const path = getPath(request.input);
      if (path && !isPathInside(this.options.cwd, resolve(this.options.cwd, path))) {
        return "ask";
      }
      return "allow";
    }

    return "ask";
  }
}
