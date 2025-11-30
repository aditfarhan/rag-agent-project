import { Request, Response } from "express";

import { handleChat } from "@app/chat/ChatUseCase";
import { ValidationError } from "@middleware/errorHandler";

import { ChatRequestSchema, ChatResponseSchema } from "./chat/schema";

import type { ChatMessage } from "@app/chat/ChatUseCase";

interface ZodErrorLike {
  issues?: unknown;
}

interface MutableErrorLike {
  statusCode?: number;
  message?: string;
  issues?: unknown;
}

/**
 * Chat HTTP controller.
 *
 * Wraps the Express handler for /api/chat and delegates to ChatUseCase.
 * Route signature and behaviour remain unchanged.
 *
 * Step 8/9: adds DTO validation using Zod; valid payload behaviour is identical.
 */
export async function chatController(
  req: Request,
  res: Response
): Promise<void> {
  try {
    // Request DTO validation
    const parsed = ChatRequestSchema.parse(req.body);
    const {
      userId,
      question,
      history = [],
    } = parsed as {
      userId: string;
      question: string;
      history?: ChatMessage[];
    };

    const result = await handleChat({
      userId,
      question,
      history,
    });

    // Response DTO validation (no mutation of returned payload)
    try {
      ChatResponseSchema.parse(result);
    } catch (parseErr: unknown) {
      const zodErr = parseErr as ZodErrorLike;

      if (zodErr.issues) {
        throw new ValidationError("Invalid response", {
          issues: zodErr.issues,
        });
      }
      throw parseErr;
    }

    res.json(result);
  } catch (err: unknown) {
    const mutable = err as MutableErrorLike;

    if (mutable.issues) {
      // Validation error from Zod on request.
      throw new ValidationError("Invalid request", { issues: mutable.issues });
    }

    mutable.statusCode = mutable.statusCode || 500;
    mutable.message = mutable.message || "Chat processing failed";
    throw err;
  }
}
