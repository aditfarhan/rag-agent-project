/**
 * Global error handling middleware for the RAG system.
 *
 * Centralized error processing and HTTP response formatting:
 * - Custom error classes for domain, infrastructure, and validation errors
 * - Structured error logging with metadata capture
 * - Consistent JSON error responses with appropriate status codes
 *
 * Ensures robust error handling across all API endpoints while maintaining
 * observability and proper client-facing error communication.
 */
import { logger } from "@infrastructure/logging/Logger";
import { Request, Response, NextFunction } from "express";

export type AppErrorType =
  | "DomainError"
  | "InfrastructureError"
  | "AppError"
  | "ValidationError";

export interface AppErrorMetadata {
  [key: string]: unknown;
}

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

export class DomainError extends AppError {
  constructor(
    message: string,
    statusCode?: number,
    metadata?: AppErrorMetadata
  ) {
    super(message, "DomainError", statusCode, metadata);
  }
}

export class InfrastructureError extends AppError {
  constructor(
    message: string,
    statusCode?: number,
    metadata?: AppErrorMetadata
  ) {
    super(message, "InfrastructureError", statusCode, metadata);
  }
}

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

export function isAppError(error: unknown): error is AppError {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate =
    error && typeof error === "object"
      ? {
          type: (error as { type?: string }).type,
          statusCode: (error as { statusCode?: number }).statusCode,
          message: (error as { message?: string }).message,
        }
      : {};

  return (
    typeof candidate.message === "string" && typeof candidate.type === "string"
  );
}

export function isApiError(error: unknown): error is AppError {
  return isAppError(error);
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  console.error("🔥 Global Error Handler:", err);

  let appError: AppError;

  if (isAppError(err) || isApiError(err)) {
    appError = err;
  } else {
    const message =
      err &&
      typeof err === "object" &&
      typeof (err as { message?: string }).message === "string"
        ? String((err as { message?: string }).message)
        : "Internal Server Error";

    const statusCode =
      err &&
      typeof err === "object" &&
      typeof (err as { statusCode?: number }).statusCode === "number"
        ? Number((err as { statusCode?: number }).statusCode)
        : 500;

    appError = new InfrastructureError(message, statusCode, {
      originalError: err,
    });
  }

  const status = appError.statusCode ?? 500;

  logger.log("error", "Unhandled error", {
    type: appError.type,
    statusCode: status,
    message: appError.message,
    metadata: appError.metadata ? JSON.stringify(appError.metadata) : undefined,
    originalError: appError === err ? undefined : String(err),
  });

  res.status(status).json({
    error: {
      message: appError.message,
      code: appError.type,
      details: appError.metadata ?? {},
    },
  });
}
