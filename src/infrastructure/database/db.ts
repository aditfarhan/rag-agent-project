/**
 * PostgreSQL database connection pool.
 *
 * Centralized database connection management for the RAG system:
 * - Configures connection pool with environment-based settings
 * - Handles connection lifecycle and error recovery
 * - Provides shared pool for all database operations
 *
 * Foundation layer enabling both RAG vector storage and memory persistence.
 */
import { config } from "@config/index";
import { Pool } from "pg";


export const pool = new Pool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  max: config.db.max,
  idleTimeoutMillis: config.db.idleTimeoutMs,
  connectionTimeoutMillis: config.db.connectionTimeoutMs,
});

pool.on("error", (err) => {
  console.error("Unexpected PG pool error:", err);
});
