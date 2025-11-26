import { Router } from "express";
import { embedText } from "../service/embedding";
import { semanticSearch } from "../services/ragService";

const router = Router();

/**
 * Semantic search over ingested chunks.
 *
 * This route now delegates its vector search logic to the unified RAG
 * retrieval engine in services/ragService, while preserving the API:
 *   POST /api/search { query } -> { query, results }
 */
router.post("/", async (req, res) => {
  try {
    const { query } = req.body;

    if (!query) {
      return res.status(400).json({ error: "query is required" });
    }

    // 1) Embed query text (centralized embedding service under the hood).
    const embedding = await embedText(query);

    // 2) Run semantic search via the unified RAG engine.
    const results = await semanticSearch(embedding, 5);

    return res.json({
      query,
      results,
    });
  } catch (error: any) {
    console.error("Search error:", error);
    return res
      .status(500)
      .json({ error: "search failed", detail: error.message });
  }
});

export default router;
