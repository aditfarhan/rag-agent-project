/**
 * Centralized logging system for RAG + Mastra AI agent observability.
 *
 * Provides structured logging and event tracking for system operations:
 * - JSON-formatted logs with ISO timestamps for structured analysis
 * - Dual output: console display + persistent file logging
 * - Event-style logging for business events (INGEST_SUCCESS, CHAT_REQUEST, etc.)
 * - Type-safe logging interface with configurable log levels
 *
 * Critical infrastructure for monitoring RAG retrieval quality, memory operations,
 * and LLM interaction patterns in production environments.
 */
import fs from "fs";
import path from "path";

export type LogLevel = "info" | "warn" | "error" | "debug";

export interface LoggerPort {
  log(level: LogLevel, message: string, meta?: Record<string, unknown>): void;
  event?(type: string, payload: Record<string, unknown>): void;
}

const logDir = path.join(process.cwd(), "logs");
const logFile = path.join(logDir, "app.log");

function ensureLogDir(): void {
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
}

function writeEntry(entry: Record<string, unknown>): void {
  ensureLogDir();

  const line = JSON.stringify(entry) + "\n";

  console.log(entry);

  try {
    fs.appendFileSync(logFile, line, { encoding: "utf-8" });
  } catch (err) {
    console.error("❌ Failed to write log file:", err);
  }
}

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

export function logEvent(type: string, payload: Record<string, unknown>): void {
  if (typeof logger.event === "function") {
    logger.event(type, payload);
    return;
  }

  logger.log("info", type, payload);
}
