import { z } from "zod";

/**
 * Zod validation schemas for document ingestion API.
 *
 * Defines request/response DTOs for the RAG document upload interface:
 * - IngestRequestSchema: Validates file paths and document metadata
 * - IngestResponseSchema: Ensures consistent ingestion result format
 *
 * Type-safe validation for document processing pipeline without side effects.
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
