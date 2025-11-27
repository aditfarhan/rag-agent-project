import { client } from "./openAIClient";
import { config } from "../config";
import { logEvent } from "../utils/logger";

/**
 * Embedding service
 *
 * Responsibilities:
 * - Provide a single, centralized API for generating text embeddings.
 * - Use config-driven model selection and timeouts (via the shared OpenAI client).
 * - Support both single-text and batched embeddings for performance.
 * - Emit structured logs for observability.
 */

/**
 * Generate an embedding for a single text input.
 *
 * This is the primary entry point used by higher-level services.
 */
export async function embedText(text: string): Promise<number[]> {
  const normalized = text?.trim() ?? "";

  if (!normalized) {
    throw new Error("Cannot embed empty text");
  }

  const startedAt = Date.now();

  try {
    const response = await client.embeddings.create({
      model: config.openai.embeddingModel,
      input: normalized,
    });

    const first = response.data[0];

    if (!first || !first.embedding) {
      const err = new Error("Embedding API returned invalid data");
      (err as any).statusCode = 502;
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
  } catch (error: any) {
    const durationMs = Date.now() - startedAt;

    logEvent("EMBEDDING_FAILURE", {
      model: config.openai.embeddingModel,
      durationMs,
      message: error?.message || String(error),
      name: error?.name,
    });

    const err =
      error instanceof Error ? error : new Error("Embedding request failed");
    (err as any).statusCode = (error as any)?.statusCode || 502;
    throw err;
  }
}

/**
 * Generate embeddings for a batch of texts in a single API call.
 *
 * This is useful for ingest flows where many chunks must be embedded.
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  const normalized = texts.map((t) => (t ?? "").trim());
  const nonEmpty = normalized.filter((t) => t.length > 0);

  if (nonEmpty.length === 0) {
    return [];
  }

  const startedAt = Date.now();

  try {
    const response = await client.embeddings.create({
      model: config.openai.embeddingModel,
      input: nonEmpty,
    });

    const durationMs = Date.now() - startedAt;

    logEvent("EMBEDDING_BATCH_SUCCESS", {
      model: config.openai.embeddingModel,
      durationMs,
      batchSize: nonEmpty.length,
      vectorLength: response.data[0]?.embedding?.length ?? 0,
    });

    return response.data.map((item) => item.embedding as number[]);
  } catch (error: any) {
    const durationMs = Date.now() - startedAt;

    logEvent("EMBEDDING_BATCH_FAILURE", {
      model: config.openai.embeddingModel,
      durationMs,
      batchSize: nonEmpty.length,
      message: error?.message || String(error),
      name: error?.name,
    });

    const err =
      error instanceof Error
        ? error
        : new Error("Batch embedding request failed");
    (err as any).statusCode = (error as any)?.statusCode || 502;
    throw err;
  }
}
