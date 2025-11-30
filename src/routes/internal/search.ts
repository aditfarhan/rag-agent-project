import { searchController } from "@interfaces/http/SearchController";
import { Router } from "express";

const router = Router();

/**
 * Semantic search over ingested chunks.
 *
 * This route delegates HTTP concerns to the SearchController, which in turn
 * calls the application-layer SearchUseCase via the searchService facade.
 * The API remains:
 *   POST /api/internal/search { query } -> { query, results }
 */
router.post("/", searchController);

export default router;
