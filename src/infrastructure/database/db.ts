import { Pool } from "pg";

import { config } from "@config/index";

/**
 * Centralized PostgreSQL connection pool (infrastructure layer).
 *
 * All database access in the application should go through this pool or thin
 * wrappers built on top of it. Configuration is sourced exclusively from the
 * centralized config module.
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
  // Keep behavior identical to the previous implementation: log to stderr.
  // Higher-level code is responsible for surfacing DB failures to clients.

  console.error("Unexpected PG pool error:", err);
});
