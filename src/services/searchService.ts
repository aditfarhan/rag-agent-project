import { embedText } from "./embeddingService";
import { semanticSearch, ChunkRow } from "./ragService";

export interface SemanticSearchRequest {
  query: string;
  limit?: number;
}

export interface SemanticSearchResponse {
  query: string;
  results: ChunkRow[];
}

/**
 * High-level semantic search service.
 *
 * Responsibilities:
 * - Accept raw user query text.
 * - Generate an embedding via the shared EmbeddingService.
 * - Delegate vector search to the RAG retrieval service.
 * - Return a stable response shape for HTTP and other callers.
 */
export async function searchDocumentsByText(
  input: SemanticSearchRequest
): Promise<SemanticSearchResponse> {
  const { query, limit = 5 } = input;
  const normalized = query?.trim();

  if (!normalized) {
    const err = new Error("query is required");
    (err as any).statusCode = 400;
    throw err;
  }

  const embedding = await embedText(normalized);
  const results = await semanticSearch(embedding, limit);

  return {
    query: normalized,
    results,
  };
}
