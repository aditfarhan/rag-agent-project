import { z } from "zod";

/**
 * Step 8/9: DTO validation schemas for /api/internal/search.
 * These are used only in the controller and have no side effects.
 */
export const SearchRequestSchema = z.object({
  query: z.string().min(1),
});

/**
 * Response schema used to validate the search UseCase output (via a DTO)
 * without changing the actual HTTP response body.
 */
export const SearchResponseSchema = z.object({
  results: z.array(
    z.object({
      id: z.number(),
      content: z.string(),
      distance: z.number(),
    })
  ),
});
