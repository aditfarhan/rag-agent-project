/**
 * Embedding provider for vector-based semantic operations in RAG system.
 *
 * Centralized text-to-vector conversion service enabling semantic search:
 * - OpenAI embedding API integration with configurable models
 * - Single-text and batch embedding support for performance optimization
 * - Structured error handling and observability logging
 * - Config-driven model selection and timeout management
 *
 * Critical infrastructure component powering both RAG document retrieval
 * and memory similarity search through consistent vector representation.
 */
import { config } from "@config/index";
import { logEvent } from "@infra/logging/Logger";

import { client, withRetry } from "./OpenAIAdapter";
import type { StatusCodeError } from "../../types/StatusCodeError";

export async function embedText(text: string): Promise<number[]> {
  const normalized = text?.trim() ?? "";

  if (!normalized) {
    throw new Error("Cannot embed empty text");
  }

  const startedAt = Date.now();

  try {
    const response = await withRetry(
      () =>
        client.embeddings.create({
          model: config.openai.embeddingModel,
          input: normalized,
        }),
      "embeddings.create.single"
    );

    const first = response.data[0];

    if (!first || !first.embedding) {
      const err: StatusCodeError = new Error(
        "Embedding API returned invalid data"
      );
      err.statusCode = 502;
      throw err;
    }

    const durationMs = Date.now() - startedAt;

    logEvent("EMBEDDING_SUCCESS", {
      model: config.openai.embeddingModel,
      durationMs,
      inputLength: normalized.length,
      vectorLength: first.embedding.length,
    });

    return first.embedding;
  } catch (error: unknown) {
    const durationMs = Date.now() - startedAt;

    const typed = error as {
      message?: unknown;
      name?: unknown;
      statusCode?: unknown;
    };

    logEvent("EMBEDDING_FAILURE", {
      model: config.openai.embeddingModel,
      durationMs,
      message:
        typeof typed.message === "string" ? typed.message : String(error),
      name: typeof typed.name === "string" ? typed.name : undefined,
    });

    const err: StatusCodeError =
      error instanceof Error
        ? (error as StatusCodeError)
        : new Error("Embedding request failed");
    err.statusCode =
      typeof typed.statusCode === "number" ? typed.statusCode : 502;
    throw err;
  }
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  const normalized = texts.map((t) => (t ?? "").trim());
  const nonEmpty = normalized.filter((t) => t.length > 0);

  if (nonEmpty.length === 0) {
    return [];
  }

  const startedAt = Date.now();

  try {
    const response = await withRetry(
      () =>
        client.embeddings.create({
          model: config.openai.embeddingModel,
          input: nonEmpty,
        }),
      "embeddings.create.batch"
    );

    const durationMs = Date.now() - startedAt;

    logEvent("EMBEDDING_BATCH_SUCCESS", {
      model: config.openai.embeddingModel,
      durationMs,
      batchSize: nonEmpty.length,
      vectorLength: response.data[0]?.embedding?.length ?? 0,
    });

    return response.data.map((item) => item.embedding as number[]);
  } catch (error: unknown) {
    const durationMs = Date.now() - startedAt;

    const typed = error as {
      message?: unknown;
      name?: unknown;
      statusCode?: unknown;
    };

    logEvent("EMBEDDING_BATCH_FAILURE", {
      model: config.openai.embeddingModel,
      durationMs,
      batchSize: nonEmpty.length,
      message:
        typeof typed.message === "string" ? typed.message : String(error),
      name: typeof typed.name === "string" ? typed.name : undefined,
    });

    const err: StatusCodeError =
      error instanceof Error
        ? (error as StatusCodeError)
        : new Error("Batch embedding request failed");
    err.statusCode =
      typeof typed.statusCode === "number" ? typed.statusCode : 502;
    throw err;
  }
}
