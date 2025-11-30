import { z } from "zod";

/**
 * Step 8/9: DTO validation schemas for /api/chat.
 * These are used only in the controller and have no side effects.
 */

// Request schema
export const ChatRequestSchema = z.object({
  userId: z.string().min(1),
  question: z.string().min(1),
  history: z.array(z.unknown()).optional(),
});

// Response schema (shapes the existing ChatUseCase response without changing it)
export const ChatResponseSchema = z.object({
  answer: z.string(),
  history: z.array(
    z.object({
      role: z.string(),
      content: z.string(),
    })
  ),
  contextUsed: z.array(z.unknown()),
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
