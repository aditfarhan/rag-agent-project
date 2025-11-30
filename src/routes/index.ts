import searchRouter from "./internal/search";
import chatRouter from "./public/chat";
import healthRouter from "./public/health";
import ingestRouter from "./public/ingest";

import type { Express } from "express";

/**
 * Step 10: central route registration.
 *
 * This function wires all HTTP routes to the Express app while preserving the
 * existing public API paths and behaviour (no contract changes).
 */
export function registerRoutes(app: Express): void {
  app.use("/api/health", healthRouter);
  app.use("/api/documents/ingest", ingestRouter);
  app.use("/api/chat", chatRouter);
  app.use("/api/internal/search", searchRouter);
}
