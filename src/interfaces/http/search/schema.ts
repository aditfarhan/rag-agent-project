import { z } from "zod";

/**
 * Zod validation schemas for semantic search API.
 *
 * Defines request/response DTOs for the internal document search interface:
 * - SearchRequestSchema: Validates search queries
 * - SearchResponseSchema: Ensures consistent search result format
 *
 * Type-safe validation for RAG retrieval testing without side effects.
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
