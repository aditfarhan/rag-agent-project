import { z } from "zod";

/**
 * Zod validation schemas for chat API endpoints in conversational AI interface.
 *
 * Defines request/response DTOs for the RAG + Mastra AI chat system:
 * - ChatRequestSchema: Validates user questions with optional history
 * - ChatResponseSchema: Ensures consistent response format with metadata
 *
 * Type-safe validation ensuring API contract compliance without side effects.
 */
export const ChatRequestSchema = z.object({
  userId: z.string().min(1),
  question: z.string().min(1),
  history: z
    .array(
      z.object({
        role: z.string(),
        content: z.string(),
      })
    )
    .optional(),
});

export const ChatResponseSchema = z.object({
  answer: z.string(),
  history: z.array(
    z.object({
      role: z.string(),
      content: z.string(),
    })
  ),
  contextUsed: z.array(
    z.object({
      id: z.number(),
      document_id: z.number(),
      chunk_index: z.number(),
      content: z.string(),
    })
  ),
  memoryUsed: z.boolean(),
  meta: z.object({
    rag: z.object({
      topK: z.number(),
      distanceThreshold: z.number(),
      chunksReturned: z.number(),
    }),
    memory: z.object({
      similarTopK: z.number(),
      factsCount: z.number(),
    }),
  }),
});
