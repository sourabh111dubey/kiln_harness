import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

export interface AuditEntry {
  timestamp: string;
  sessionID: string;
  tool: string;
  decision: "allow" | "ask" | "deny";
  cwd: string;
  inputHash: string;
  summary: string;
}

export class AuditLog {
  constructor(private readonly filePath: string) {}

  record(entry: Omit<AuditEntry, "timestamp">): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const record: AuditEntry = { ...entry, timestamp: new Date().toISOString() };
    appendFileSync(this.filePath, `${JSON.stringify(record)}\n`, "utf8");
  }

  read(limit = 50): AuditEntry[] {
    if (!existsSync(this.filePath)) return [];
    const lines = readFileSync(this.filePath, "utf8")
      .split("\n")
      .filter((line) => line.length > 0);
    const entries: AuditEntry[] = [];
    for (const line of lines.slice(-limit)) {
      try {
        entries.push(JSON.parse(line) as AuditEntry);
      } catch {
        // Skip malformed audit lines instead of failing the command.
      }
    }
    return entries;
  }
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function hashInput(input: unknown): string {
  return createHash("sha256").update(stableStringify(input)).digest("hex").slice(0, 16);
}

export function summarizeInput(input: unknown): string {
  if (typeof input === "object" && input !== null && !Array.isArray(input)) {
    const record = input as Record<string, unknown>;
    if (typeof record.path === "string") return record.path;
    if (typeof record.command === "string") return record.command.slice(0, 200);
    if (typeof record.pattern === "string") return record.pattern.slice(0, 200);
  }
  return JSON.stringify(input).slice(0, 200);
}
