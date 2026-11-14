export type KilncraftErrorCode =
  | "invalid_argument"
  | "invalid_config"
  | "not_implemented"
  | "provider_error"
  | "provider_auth"
  | "provider_rate_limited"
  | "tool_error"
  | "tool_not_found"
  | "permission_denied"
  | "sandbox_unavailable"
  | "session_not_found"
  | "context_overflow"
  | "aborted"
  | "io_error"
  | "internal_error";

export interface KilncraftErrorOptions {
  details?: Record<string, unknown>;
  cause?: unknown;
  recoverable?: boolean;
  hint?: string;
}

export class KilncraftError extends Error {
  readonly code: KilncraftErrorCode;
  readonly details: Record<string, unknown>;
  readonly recoverable: boolean;
  readonly hint?: string;

  constructor(code: KilncraftErrorCode, message: string, options: KilncraftErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = "KilncraftError";
    this.code = code;
    this.details = options.details ?? {};
    this.recoverable = options.recoverable ?? false;
    this.hint = options.hint;
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      details: this.details,
      recoverable: this.recoverable,
      hint: this.hint,
      stack: this.stack,
    };
  }
}

export function isKilncraftError(value: unknown): value is KilncraftError {
  return value instanceof KilncraftError;
}

export function toKilncraftError(
  error: unknown,
  fallbackCode: KilncraftErrorCode = "internal_error",
): KilncraftError {
  if (isKilncraftError(error)) return error;
  if (error instanceof Error) {
    if (error.name === "AbortError" || (error as { code?: unknown }).code === "ABORT_ERR") {
      return new KilncraftError("aborted", error.message, { cause: error });
    }
    return new KilncraftError(fallbackCode, error.message, {
      cause: error,
      details: { name: error.name },
      recoverable: false,
    });
  }
  return new KilncraftError(fallbackCode, String(error), {
    details: { value: String(error) },
    recoverable: false,
  });
}

export const errors = {
  invalidArgument: (message: string, details?: Record<string, unknown>): KilncraftError =>
    new KilncraftError("invalid_argument", message, { details }),
  invalidConfig: (message: string, hint?: string): KilncraftError =>
    new KilncraftError("invalid_config", message, { hint }),
  notImplemented: (feature: string): KilncraftError =>
    new KilncraftError("not_implemented", `${feature} is not implemented yet`, {
      hint: "See plan.md for the milestone that delivers this feature.",
    }),
  providerError: (message: string, cause?: unknown): KilncraftError =>
    new KilncraftError("provider_error", message, { cause, recoverable: true }),
  toolError: (tool: string, message: string, details?: Record<string, unknown>): KilncraftError =>
    new KilncraftError("tool_error", `${tool}: ${message}`, { details }),
  permissionDenied: (message: string): KilncraftError =>
    new KilncraftError("permission_denied", message, { recoverable: false }),
  sessionNotFound: (sessionID: string): KilncraftError =>
    new KilncraftError("session_not_found", `Session ${sessionID} was not found`, {
      details: { sessionID },
    }),
  aborted: (reason?: string): KilncraftError =>
    new KilncraftError("aborted", reason ?? "Operation aborted", { recoverable: false }),
};
