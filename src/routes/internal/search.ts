import { Router } from "express";
import { searchDocumentsByText } from "../../services/searchService";

const router = Router();

/**
 * Semantic search over ingested chunks.
 *
 * This route now delegates its vector search logic to the unified RAG
 * retrieval engine in services/ragService, while preserving the API:
 *   POST /api/search { query } -> { query, results }
 */
router.post("/", async (req, res, next) => {
  try {
    const { query, limit } = req.body;

    const result = await searchDocumentsByText({ query, limit });

    return res.json(result);
  } catch (err: any) {
    err.statusCode = err.statusCode || 500;
    err.message = err.message || "Search failed";
    return next(err);
  }
});

export default router;
