import { Request, Response, NextFunction } from "express";

import { searchDocumentsByText } from "@app/search/SearchUseCase";
import { ValidationError } from "@middleware/errorHandler";

import { SearchRequestSchema, SearchResponseSchema } from "./search/schema";

import type { ChunkRow } from "@domain/rag/ragEngine";

interface ZodErrorLike {
  issues?: unknown;
}

interface MutableErrorLike {
  statusCode?: number;
  message?: string;
  issues?: unknown;
}

/**
 * Search HTTP controller.
 *
 * Wraps the Express handler for /api/internal/search and delegates to
 * SearchUseCase. Route signature and behaviour remain unchanged.
 *
 * Step 8/9: adds DTO validation using Zod; valid payload behaviour is identical.
 */
export async function searchController(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // Request DTO validation
    const { query } = SearchRequestSchema.parse(req.body);
    const { limit } = req.body;

    const result = await searchDocumentsByText({ query, limit });

    // Response DTO validation on a derived DTO, without mutating the actual response.
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

    // Preserve original HTTP response shape
    res.json(result);
  } catch (err: unknown) {
    const mutable = err as MutableErrorLike;

    if (mutable.issues) {
      // Validation error from Zod: surface as a unified ValidationError.
      return next(
        new ValidationError("Invalid request", { issues: mutable.issues })
      );
    }

    mutable.statusCode = mutable.statusCode || 500;
    mutable.message = mutable.message || "Search failed";
    next(mutable);
  }
}
