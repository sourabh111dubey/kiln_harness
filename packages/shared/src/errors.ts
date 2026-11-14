export type HarnessErrorCode =
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

export interface HarnessErrorOptions {
  details?: Record<string, unknown>;
  cause?: unknown;
  recoverable?: boolean;
  hint?: string;
}

export class HarnessError extends Error {
  readonly code: HarnessErrorCode;
  readonly details: Record<string, unknown>;
  readonly recoverable: boolean;
  readonly hint?: string;

  constructor(code: HarnessErrorCode, message: string, options: HarnessErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = "HarnessError";
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

export function isHarnessError(value: unknown): value is HarnessError {
  return value instanceof HarnessError;
}

export function toHarnessError(
  error: unknown,
  fallbackCode: HarnessErrorCode = "internal_error",
): HarnessError {
  if (isHarnessError(error)) return error;
  if (error instanceof Error) {
    if (error.name === "AbortError" || (error as { code?: unknown }).code === "ABORT_ERR") {
      return new HarnessError("aborted", error.message, { cause: error });
    }
    return new HarnessError(fallbackCode, error.message, {
      cause: error,
      details: { name: error.name },
      recoverable: false,
    });
  }
  return new HarnessError(fallbackCode, String(error), {
    details: { value: String(error) },
    recoverable: false,
  });
}

export const errors = {
  invalidArgument: (message: string, details?: Record<string, unknown>): HarnessError =>
    new HarnessError("invalid_argument", message, { details }),
  invalidConfig: (message: string, hint?: string): HarnessError =>
    new HarnessError("invalid_config", message, { hint }),
  notImplemented: (feature: string): HarnessError =>
    new HarnessError("not_implemented", `${feature} is not implemented yet`, {
      hint: "See plan.md for the milestone that delivers this feature.",
    }),
  providerError: (message: string, cause?: unknown): HarnessError =>
    new HarnessError("provider_error", message, { cause, recoverable: true }),
  toolError: (tool: string, message: string, details?: Record<string, unknown>): HarnessError =>
    new HarnessError("tool_error", `${tool}: ${message}`, { details }),
  permissionDenied: (message: string): HarnessError =>
    new HarnessError("permission_denied", message, { recoverable: false }),
  sessionNotFound: (sessionID: string): HarnessError =>
    new HarnessError("session_not_found", `Session ${sessionID} was not found`, {
      details: { sessionID },
    }),
  aborted: (reason?: string): HarnessError =>
    new HarnessError("aborted", reason ?? "Operation aborted", { recoverable: false }),
};
