import fs from "fs";
import path from "path";

/**
 * Minimal logger port/type definitions inlined from the former core/logging module.
 * This is type-only and does not change behaviour of the logger implementation.
 */
export type LogLevel = "info" | "warn" | "error" | "debug";

export interface LoggerPort {
  log(level: LogLevel, message: string, meta?: Record<string, unknown>): void;
  event?(type: string, payload: Record<string, unknown>): void;
}

const logDir = path.join(process.cwd(), "logs");
const logFile = path.join(logDir, "app.log");

// Ensure logs directory exists
function ensureLogDir(): void {
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
}

function writeEntry(entry: Record<string, unknown>): void {
  ensureLogDir();

  const line = JSON.stringify(entry) + "\n";

  // Always print to console
  // NOTE: Keep behavior identical to the original implementation.

  console.log(entry);

  // Safely persist to file
  try {
    fs.appendFileSync(logFile, line, { encoding: "utf-8" });
  } catch (err) {
    // Preserve original error logging behavior.

    console.error("❌ Failed to write log file:", err);
  }
}

/**
 * Infrastructure logger implementing the LoggerPort.
 *
 * - Uses ISO timestamp.
 * - Records log level when using log().
 * - Preserves existing event-style logging via logEvent(), which keeps the
 *   original shape: { timestamp, type, ...payload }.
 */
export const logger: LoggerPort = {
  log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    const entry: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...(meta || {}),
    };

    writeEntry(entry);
  },

  event(type: string, payload: Record<string, unknown>): void {
    const entry: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      type,
      ...payload,
    };

    writeEntry(entry);
  },
};

/**
 * Backwards-compatible event logger.
 *
 * This preserves the exact behavior of the original utils/logger.ts:
 * - Same function name: logEvent(type, payload)
 * - Same output shape: { timestamp, type, ...payload }
 */
export function logEvent(type: string, payload: Record<string, unknown>): void {
  if (typeof logger.event === "function") {
    logger.event(type, payload);
    return;
  }

  // Fallback, should not be hit with the current implementation.
  logger.log("info", type, payload);
}
