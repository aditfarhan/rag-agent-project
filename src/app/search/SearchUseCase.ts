import { semanticSearch, ChunkRow } from "@domain/rag/ragEngine";
import { embedText } from "@infra/llm/EmbeddingProvider";

import type { StatusCodeError } from "../../types/StatusCodeError";

export interface SemanticSearchRequest {
  query: string;
  limit?: number;
}

export interface SemanticSearchResponse {
  query: string;
  results: ChunkRow[];
}

/**
 * Application-level semantic search use-case.
 *
 * Responsibilities:
 * - Accept raw user query text.
 * - Generate an embedding via the shared EmbeddingService.
 * - Delegate vector search to the domain RAG engine.
 * - Return a stable response shape for HTTP and other callers.
 *
 * Behavior is preserved exactly from the original services/searchService.ts.
 */
export async function searchDocumentsByText(
  input: SemanticSearchRequest
): Promise<SemanticSearchResponse> {
  const { query, limit = 5 } = input;
  const normalized = query?.trim();

  if (!normalized) {
    const err: StatusCodeError = new Error("query is required");
    err.statusCode = 400;
    throw err;
  }

  const embedding = await embedText(normalized);
  const results = await semanticSearch(embedding, limit);

  return {
    query: normalized,
    results,
  };
}
