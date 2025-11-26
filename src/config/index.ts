import dotenv from "dotenv";

dotenv.config();

/**
 * Centralized configuration layer.
 *
 * All access to environment variables MUST go through this module.
 * No services, routes, utils, or core logic should read from process.env directly.
 */

const openaiKey = process.env.OPENAI_API_KEY;

// ❗ Fail fast if missing — LLM is a hard dependency for this app.
if (!openaiKey) {
  throw new Error(
    "OPENAI_API_KEY is missing. Please set it in your .env file."
  );
}

export const config = {
  env: process.env.NODE_ENV || "development",

  openai: {
    key: openaiKey,
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    embeddingModel:
      process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small",
    baseUrl: process.env.OPENAI_BASE_URL || undefined,
    timeoutMs: Number(process.env.OPENAI_TIMEOUT_MS || 30000),
  },

  db: {
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    max: Number(process.env.DB_POOL_MAX || 10),
    idleTimeoutMs: Number(process.env.DB_IDLE_TIMEOUT_MS || 30000),
    connectionTimeoutMs: Number(process.env.DB_CONN_TIMEOUT_MS || 10000),
  },

  port: Number(process.env.PORT || 3000),

  rag: {
    topK: Number(process.env.RAG_TOP_K || 5),
    distanceThreshold: Number(process.env.RAG_DISTANCE_THRESHOLD || 1.2),
  },

  memory: {
    similarTopK: Number(process.env.MEMORY_SIMILAR_TOP_K || 5),
  },

  observability: {
    logLevel: process.env.LOG_LEVEL || "info",
  },
} as const;
