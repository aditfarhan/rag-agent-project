import { Pool } from "pg";
import { config } from "../config";

/**
 * Centralized PostgreSQL connection pool.
 *
 * All database access should go through this pool (or thin wrappers on top),
 * and configuration must come from the config module, not from process.env.
 */
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

// Basic pool-level error logging to avoid silent connection issues.
pool.on("error", (err) => {
  console.error("Unexpected PG pool error:", err);
});
