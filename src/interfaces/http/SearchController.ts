/**
 * Semantic search HTTP controller for document retrieval.
 *
 * Express handler for /api/internal/search enabling vector-based document search:
 * - Validates search queries using Zod schemas
 * - Delegates to SearchUseCase for semantic similarity search
 * - Provides low-level document retrieval for debugging and analysis
 *
 * Internal endpoint for testing and monitoring RAG retrieval quality,
 * exposing the raw similarity search capabilities.
 */
import { searchDocumentsByText } from "@app/search/SearchUseCase";
import type { ChunkRow } from "@domain/rag/ragEngine";
import {
  SearchRequestSchema,
  SearchResponseSchema,
} from "@interfaces/http/search/schema";
import { ValidationError } from "@middleware/errorHandler";
import { Request, Response, NextFunction } from "express";


interface ZodErrorLike {
  issues?: unknown[] | undefined;
}

interface MutableErrorLike {
  statusCode?: number;
  message?: string;
  issues?: unknown[] | undefined;
}

export async function searchController(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { query } = SearchRequestSchema.parse(req.body);
    const { limit } = req.body;

    const result = await searchDocumentsByText({ query, limit });

    try {
      SearchResponseSchema.parse({
        results: result.results.map((row: ChunkRow) => ({
          id: row.id,
          content: row.content,
          distance:
            typeof row.distance === "number"
              ? row.distance
              : typeof row.similarity === "number"
                ? row.similarity
                : 0,
        })),
      });
    } catch (parseErr: unknown) {
      const zodErr = parseErr as ZodErrorLike;

      if (zodErr.issues) {
        return next(
          new ValidationError("Invalid response", { issues: zodErr.issues })
        );
      }
      return next(parseErr);
    }

    res.json(result);
  } catch (err: unknown) {
    const mutable = err as MutableErrorLike;

    if (mutable.issues) {
      return next(
        new ValidationError("Invalid request", { issues: mutable.issues })
      );
    }

    mutable.statusCode = mutable.statusCode || 500;
    mutable.message = mutable.message || "Search failed";
    next(mutable);
  }
}
