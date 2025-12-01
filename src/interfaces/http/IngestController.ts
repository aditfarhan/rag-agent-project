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

import { ingestDocument } from "@app/ingest/IngestUseCase";
import {
  IngestRequestSchema,
  IngestResponseSchema,
} from "@interfaces/http/ingest/schema";
import { ValidationError } from "@middleware/errorHandler";
import { Request, Response } from "express";

interface ZodErrorLike {
  issues?: readonly unknown[] | undefined;
}

interface MutableErrorLike {
  issues?: readonly unknown[] | undefined;
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
      const zodErr =
        parseErr && typeof parseErr === "object"
          ? { issues: (parseErr as ZodErrorLike).issues }
          : {};

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
    const mutable =
      err && typeof err === "object"
        ? { issues: (err as MutableErrorLike).issues }
        : {};

    if (mutable.issues) {
      throw new ValidationError("Invalid request", { issues: mutable.issues });
    }

    throw err;
  }
}
