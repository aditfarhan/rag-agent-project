/**
 * Public document ingestion API route for RAG system.
 *
 * Express router enabling document upload and processing:
 * - POST /api/documents/ingest: Upload and process markdown documents
 *
 * Knowledge base population endpoint for the RAG system.
 */
import { ingestController } from "@interfaces/http/IngestController";
import { Router } from "express";

const router = Router();

router.post("/", ingestController);

export default router;
