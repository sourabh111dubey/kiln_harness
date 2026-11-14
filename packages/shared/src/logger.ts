import pino, { type Logger } from "pino";

export type LogLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";

export interface LoggerOptions {
  level?: LogLevel | string;
  name?: string;
  redact?: string[];
  base?: Record<string, unknown>;
}

const DEFAULT_REDACT_PATHS = [
  "apiKey",
  "*.apiKey",
  "api_key",
  "*.api_key",
  "token",
  "*.token",
  "accessToken",
  "*.accessToken",
  "refreshToken",
  "*.refreshToken",
  "secret",
  "*.secret",
  "password",
  "*.password",
  "authorization",
  "*.authorization",
  "req.headers.authorization",
  "req.headers.cookie",
  "credentials",
  "*.credentials",
  "env.*",
  "*.env.*",
];

export function createLogger(options: LoggerOptions = {}): Logger {
  return pino({
    name: options.name ?? "kiln",
    level: options.level ?? process.env.KILN_LOG_LEVEL ?? "info",
    base: options.base,
    redact: {
      paths: options.redact ?? DEFAULT_REDACT_PATHS,
      censor: "[REDACTED]",
    },
  });
}

export function redactValue(value: string): string {
  return value.replace(/(sk-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._-]{8,})/g, "[REDACTED]");
}
