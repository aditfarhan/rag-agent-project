/**
 * Document ingestion HTTP controller for RAG system.
 *
 * Express handler for /api/documents/ingest that processes document uploads:
 * - Validates file paths and metadata using Zod schemas
 * - Delegates to IngestUseCase for document processing and chunking
 * - Handles validation errors and processing failures
 *
 * HTTP boundary for populating the RAG knowledge base, enabling
 * document-driven conversational AI responses.
 */
import path from "path";
import { Request, Response } from "express";

import { ingestDocument } from "@app/ingest/IngestUseCase";
import { ValidationError } from "@middleware/errorHandler";

import { IngestRequestSchema, IngestResponseSchema } from "./ingest/schema";

interface ZodErrorLike {
  issues?: unknown;
}

interface MutableErrorLike {
  issues?: unknown;
}

export async function ingestController(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const parsed = IngestRequestSchema.parse(req.body);
    const normalizedPath = path.resolve(parsed.filepath);

    const result = await ingestDocument({
      filepath: normalizedPath,
      title: parsed.title,
    });

    try {
      IngestResponseSchema.parse({
        success: true,
        documentId: result.documentId,
        chunks: result.inserted,
      });
    } catch (parseErr: unknown) {
      const zodErr = parseErr as ZodErrorLike;

      if (zodErr.issues) {
        throw new ValidationError("Invalid response", {
          issues: zodErr.issues,
        });
      }
      throw parseErr;
    }

    res.json({
      status: "ok",
      documentId: result.documentId,
      totalChunks: result.totalChunks,
      inserted: result.inserted,
    });
  } catch (err: unknown) {
    const mutable = err as MutableErrorLike;

    if (mutable.issues) {
      throw new ValidationError("Invalid request", { issues: mutable.issues });
    }

    throw err;
  }
}
