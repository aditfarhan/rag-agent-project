/**
 * Express route registration for the RAG system API.
 *
 * Centralized route configuration exposing all system capabilities:
 * - Health check endpoint for system monitoring
 * - Document ingestion for RAG knowledge base population
 * - Conversational AI chat endpoint with memory and context
 * - Internal search endpoint for RAG retrieval testing
 *
 * Entry point for all HTTP interactions with the Mastra AI agent system.
 */

import searchRouter from "@routes/internal/search";
import chatRouter from "@routes/public/chat";
import healthRouter from "@routes/public/health";
import ingestRouter from "@routes/public/ingest";
import type { Express } from "express";

export function registerRoutes(app: Express): void {
  app.use("/api/health", healthRouter);
  app.use("/api/documents/ingest", ingestRouter);
  app.use("/api/chat", chatRouter);
  app.use("/api/internal/search", searchRouter);
}
