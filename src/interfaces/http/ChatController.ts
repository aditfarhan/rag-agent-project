/**
 * Chat HTTP controller for conversational AI endpoint.
 *
 * Express handler for /api/chat that orchestrates the full RAG pipeline:
 * - Validates incoming chat requests using Zod schemas
 * - Delegates to ChatUseCase for intent classification and response generation
 * - Handles error responses and validation failures
 *
 * HTTP boundary for the Mastra AI agent, providing the main user interaction point.
 */
import { handleChat } from "@app/chat/ChatUseCase";
import type { ChatMessage } from "@app/chat/ChatUseCase";
import {
  ChatRequestSchema,
  ChatResponseSchema,
} from "@interfaces/http/chat/schema";
import { ValidationError } from "@middleware/errorHandler";
import { Request, Response } from "express";

interface ZodErrorLike {
  issues?: readonly unknown[] | undefined;
}

interface MutableErrorLike {
  statusCode?: number;
  message?: string;
  issues?: readonly unknown[] | undefined;
}

export async function chatController(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const parsed = ChatRequestSchema.parse(req.body);
    const {
      userId,
      question,
      history = [],
    } = parsed as {
      userId: string;
      question: string;
      history?: { role: string; content: string }[];
    };

    const typedHistory: ChatMessage[] =
      history?.map((h) => ({
        role: h.role as "user" | "assistant",
        content: h.content,
      })) ?? [];

    const result = await handleChat({
      userId,
      question,
      history: typedHistory,
    });

    try {
      ChatResponseSchema.parse(result);
    } catch (parseErr: unknown) {
      const zodErr =
        parseErr && typeof parseErr === "object"
          ? {
              issues: (parseErr as ZodErrorLike).issues,
            }
          : {};

      if (zodErr.issues) {
        throw new ValidationError("Invalid response", {
          issues: zodErr.issues,
        });
      }
      throw parseErr;
    }

    res.json(result);
  } catch (err: unknown) {
    const mutable =
      err && typeof err === "object"
        ? {
            statusCode: (err as MutableErrorLike).statusCode,
            message: (err as MutableErrorLike).message,
            issues: (err as MutableErrorLike).issues,
          }
        : {};

    if (mutable.issues) {
      throw new ValidationError("Invalid request", { issues: mutable.issues });
    }

    mutable.statusCode = mutable.statusCode || 500;
    mutable.message = mutable.message || "Chat processing failed";
    throw err;
  }
}
