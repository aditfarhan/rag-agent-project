/**
 * Semantic search service for RAG document retrieval.
 *
 * Provides vector-based similarity search over ingested document chunks:
 * - Accepts user query text and generates embeddings
 * - Performs semantic similarity search using pgvector
 * - Returns ranked results with similarity scores
 * - Integrates with the RAG engine for context retrieval
 *
 * Core component for the /api/internal/search endpoint.
 */
import { semanticSearch, ChunkRow } from "@domain/rag/ragEngine";
import { embedText } from "@infrastructure/llm/EmbeddingProvider";
import { StatusCodeErrorInterface } from "@typesLocal/StatusCodeError";

export interface SemanticSearchRequest {
  query: string;
  limit?: number;
}

export interface SemanticSearchResponse {
  query: string;
  results: ChunkRow[];
}

export async function searchDocumentsByText(
  input: SemanticSearchRequest
): Promise<SemanticSearchResponse> {
  const { query, limit = 5 } = input;
  const normalized = query?.trim();

  if (!normalized) {
    const err: StatusCodeErrorInterface = new Error("query is required");
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
