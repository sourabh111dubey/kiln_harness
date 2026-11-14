export type KilnErrorCode =
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

export interface KilnErrorOptions {
  details?: Record<string, unknown>;
  cause?: unknown;
  recoverable?: boolean;
  hint?: string;
}

export class KilnError extends Error {
  readonly code: KilnErrorCode;
  readonly details: Record<string, unknown>;
  readonly recoverable: boolean;
  readonly hint?: string;

  constructor(code: KilnErrorCode, message: string, options: KilnErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = "KilnError";
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

export function isKilnError(value: unknown): value is KilnError {
  return value instanceof KilnError;
}

export function toKilnError(
  error: unknown,
  fallbackCode: KilnErrorCode = "internal_error",
): KilnError {
  if (isKilnError(error)) return error;
  if (error instanceof Error) {
    if (error.name === "AbortError" || (error as { code?: unknown }).code === "ABORT_ERR") {
      return new KilnError("aborted", error.message, { cause: error });
    }
    return new KilnError(fallbackCode, error.message, {
      cause: error,
      details: { name: error.name },
      recoverable: false,
    });
  }
  return new KilnError(fallbackCode, String(error), {
    details: { value: String(error) },
    recoverable: false,
  });
}

export const errors = {
  invalidArgument: (message: string, details?: Record<string, unknown>): KilnError =>
    new KilnError("invalid_argument", message, { details }),
  invalidConfig: (message: string, hint?: string): KilnError =>
    new KilnError("invalid_config", message, { hint }),
  notImplemented: (feature: string): KilnError =>
    new KilnError("not_implemented", `${feature} is not implemented yet`, {
      hint: "See plan.md for the milestone that delivers this feature.",
    }),
  providerError: (message: string, cause?: unknown): KilnError =>
    new KilnError("provider_error", message, { cause, recoverable: true }),
  toolError: (tool: string, message: string, details?: Record<string, unknown>): KilnError =>
    new KilnError("tool_error", `${tool}: ${message}`, { details }),
  permissionDenied: (message: string): KilnError =>
    new KilnError("permission_denied", message, { recoverable: false }),
  sessionNotFound: (sessionID: string): KilnError =>
    new KilnError("session_not_found", `Session ${sessionID} was not found`, {
      details: { sessionID },
    }),
  aborted: (reason?: string): KilnError =>
    new KilnError("aborted", reason ?? "Operation aborted", { recoverable: false }),
};
