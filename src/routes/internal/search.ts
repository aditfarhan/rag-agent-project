/**
 * Internal semantic search API for document chunk retrieval.
 *
 * Express router enabling vector-based similarity search over ingested documents:
 * - POST /api/internal/search: Raw semantic similarity search for testing/debugging
 *
 * Internal endpoint providing direct access to the RAG retrieval layer for
 * system debugging, search quality evaluation, and development purposes.
 */
import { searchController } from "@interfaces/http/SearchController";
import { Router } from "express";

const router = Router();

router.post("/", searchController);

export default router;
