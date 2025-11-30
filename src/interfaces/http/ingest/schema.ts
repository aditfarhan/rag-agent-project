import { z } from "zod";

/**
 * Step 8/9: DTO validation schemas for /api/documents/ingest.
 * These are used only in the controller and have no side effects.
 */
export const IngestRequestSchema = z.object({
  filepath: z.string().min(1),
  title: z.string().default("Uploaded Doc"),
});

/**
 * Response schema used to validate the ingest UseCase output shape
 * (via a derived DTO) without changing the actual HTTP response body.
 */
export const IngestResponseSchema = z.object({
  success: z.boolean(),
  documentId: z.number(),
  chunks: z.number(),
});
