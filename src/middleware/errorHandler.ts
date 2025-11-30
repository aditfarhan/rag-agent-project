import { Request, Response, NextFunction } from "express";

import { logger } from "@infra/logging/Logger";

/**
 * Step 7: unified error model - introduces AppError hierarchy without changing happy-path behaviour.
 */

export type AppErrorType =
  | "DomainError"
  | "InfrastructureError"
  | "AppError"
  | "ValidationError";

export interface AppErrorMetadata {
  [key: string]: unknown;
}

/**
 * Base application error with HTTP-aware status code and structured metadata.
 *
 * This class is used by the error handler to normalize error responses while
 * preserving existing statusCode and message semantics wherever possible.
 */
export class AppError extends Error {
  public readonly type: AppErrorType;
  public readonly statusCode: number | undefined;
  public readonly metadata: AppErrorMetadata | undefined;

  constructor(
    message: string,
    type: AppErrorType = "AppError",
    statusCode?: number,
    metadata?: AppErrorMetadata
  ) {
    super(message);
    this.name = new.target.name;
    this.type = type;
    this.statusCode = statusCode;
    this.metadata = metadata;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, new.target);
    }
  }
}

/**
 * Error type for domain-level validation or business logic failures.
 */
export class DomainError extends AppError {
  constructor(
    message: string,
    statusCode?: number,
    metadata?: AppErrorMetadata
  ) {
    super(message, "DomainError", statusCode, metadata);
  }
}

/**
 * Error type for infrastructure concerns such as DB, LLM, network, or filesystem.
 */
export class InfrastructureError extends AppError {
  constructor(
    message: string,
    statusCode?: number,
    metadata?: AppErrorMetadata
  ) {
    super(message, "InfrastructureError", statusCode, metadata);
  }
}

/**
 * Error type for client-side validation failures (HTTP 4xx semantics).
 *
 * Constructor is flexible to support:
 * - new ValidationError("msg", 400)
 * - new ValidationError("msg", { issues })
 * - new ValidationError("msg", 400, { issues })
 */
export class ValidationError extends AppError {
  constructor(
    message: string,
    statusOrMeta: number | AppErrorMetadata = 400,
    metadata?: AppErrorMetadata
  ) {
    if (typeof statusOrMeta === "number") {
      super(message, "ValidationError", statusOrMeta, metadata);
    } else {
      super(message, "ValidationError", 400, statusOrMeta);
    }
  }
}

/**
 * Type guard to detect AppError-compatible objects in the global error handler.
 */
export function isAppError(error: unknown): error is AppError {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as {
    type?: unknown;
    statusCode?: unknown;
    message?: unknown;
  };

  return (
    typeof candidate.message === "string" && typeof candidate.type === "string"
  );
}

/**
 * Backwards-compatible alias for existing checks used in the error handler.
 * This allows incremental migration without breaking older code paths.
 */
export function isApiError(error: unknown): error is AppError {
  return isAppError(error);
}

/**
 * Step 7: unified error model - normalize error responses without changing happy-path behaviour.
 */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  // Preserve existing console output for compatibility.
  console.error("🔥 Global Error Handler:", err);

  let appError: AppError;

  if (isAppError(err) || isApiError(err)) {
    appError = err;
  } else {
    const message =
      typeof (err as { message?: unknown })?.message === "string"
        ? (err as { message: string }).message
        : "Internal Server Error";

    const statusCode =
      typeof (err as { statusCode?: unknown })?.statusCode === "number"
        ? (err as { statusCode: number }).statusCode
        : 500;

    // Wrap unknown errors in an InfrastructureError while preserving original metadata.
    appError = new InfrastructureError(message, statusCode, {
      originalError: err,
    });
  }

  const status = appError.statusCode ?? 500;

  // Structured logging via LoggerPort, preserving original error object.
  logger.log("error", "Unhandled error", {
    type: appError.type,
    statusCode: status,
    message: appError.message,
    metadata: appError.metadata,
    originalError: appError === err ? undefined : err,
  });

  // Step 10: standardize error response shape without changing happy-path behaviour.
  res.status(status).json({
    error: {
      message: appError.message,
      code: appError.type,
      details: appError.metadata ?? {},
    },
  });
}
