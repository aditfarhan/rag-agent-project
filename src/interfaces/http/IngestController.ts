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

/**
 * Ingest HTTP controller.
 *
 * Wraps the Express handler for /api/documents/ingest and delegates to
 * IngestUseCase. Route signature and behaviour remain unchanged.
 *
 * Step 8/9: adds DTO validation using Zod; valid payload behaviour is identical.
 */
export async function ingestController(
  req: Request,
  res: Response
): Promise<void> {
  try {
    // Request DTO validation
    const parsed = IngestRequestSchema.parse(req.body);
    const normalizedPath = path.resolve(parsed.filepath);

    const result = await ingestDocument({
      filepath: normalizedPath,
      title: parsed.title,
    });

    // Response DTO validation using a derived DTO that mirrors the response semantics
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

    // Preserve original HTTP response shape
    res.json({
      status: "ok",
      documentId: result.documentId,
      totalChunks: result.totalChunks,
      inserted: result.inserted,
    });
  } catch (err: unknown) {
    const mutable = err as MutableErrorLike;

    if (mutable.issues) {
      // Validation error from Zod: surface as a unified ValidationError.
      throw new ValidationError("Invalid request", { issues: mutable.issues });
    }

    // Delegate all other errors to the global error handler.
    throw err;
  }
}
