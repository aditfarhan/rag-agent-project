import { config } from "@config/index";
import { ragRepository } from "@infra/database/PgVectorRagRepository";
import { logEvent } from "@infra/logging/Logger";

/**
 * RAG Retrieval Service (domain-level RAG engine)
 *
 * Responsibilities:
 * - Provide a single, centralized retrieval engine for document chunks.
 * - Encapsulate vector similarity queries against the `chunks` table (via infra).
 * - Apply configurable similarity thresholding and ranking.
 * - Assemble textual context for LLM consumption.
 */
export interface ChunkRow {
  id: number;
  document_id: number;
  chunk_index: number;
  content: string;
  distance?: number;
  similarity?: number;
}

export interface RagRetrievalOptions {
  topK?: number;
  distanceThreshold?: number;
}

export interface RagRetrievalResult {
  queryEmbedding: number[];
  rawChunks: ChunkRow[];
  filteredChunks: ChunkRow[];
  finalChunks: ChunkRow[];
  meta: {
    topK: number;
    distanceThreshold: number;
    chunksReturned: number;
  };
}

/**
 * Execute a vector similarity query over the chunks table, ordering by distance.
 *
 * This function now delegates to the PgVectorRagRepository adapter, which
 * preserves the original behavior (embedding <-> $1::vector ordered ASC).
 * No post-filtering is applied here; it is intended for internal use by
 * higher-level helpers.
 */
async function queryChunksByEmbedding(
  queryEmbedding: number[],
  topK: number
): Promise<ChunkRow[]> {
  return ragRepository.queryChunksByEmbedding(queryEmbedding, topK);
}

/**
 * Unified RAG retrieval with configurable thresholding and ranking.
 *
 * Behavior matches the existing /chat RAG logic:
 * - Retrieve topK nearest chunks.
 * - Filter out chunks with distance > threshold.
 * - If all filtered out, fall back to the raw topK set.
 */
export async function getRagContextForQuery(
  queryEmbedding: number[],
  options: RagRetrievalOptions = {}
): Promise<RagRetrievalResult> {
  const topK = options.topK ?? config.rag.topK;
  const distanceThreshold =
    options.distanceThreshold ?? config.rag.distanceThreshold;

  const rawChunks = await queryChunksByEmbedding(queryEmbedding, topK);

  const filteredChunks = rawChunks.filter(
    (chunk) =>
      typeof chunk.distance === "number" &&
      (chunk.distance as number) <= distanceThreshold
  );

  const finalChunks = filteredChunks.length > 0 ? filteredChunks : rawChunks;

  // const context = finalChunks.map((c) => c.content).join("\n---\n");

  logEvent("RAG_RETRIEVE", {
    topK,
    distanceThreshold,
    rawCount: rawChunks.length,
    filteredCount: filteredChunks.length,
    finalCount: finalChunks.length,
  });

  return {
    queryEmbedding,
    rawChunks,
    filteredChunks,
    finalChunks,
    meta: {
      topK,
      distanceThreshold,
      chunksReturned: finalChunks.length,
    },
  };
}

/**
 * Assemble a plain text context string from a set of chunks.
 *
 * This is exposed in case higher-level services want context-only behavior.
 */
export function buildContextFromChunks(chunks: ChunkRow[]): string {
  if (!chunks.length) {
    return "";
  }

  return chunks.map((c) => c.content).join("\n---\n");
}

/**
 * Simple document search by vector similarity, returning the top N chunks.
 *
 * This keeps the /api/search behavior but routes DB access through the
 * PgVectorRagRepository adapter for consistency and observability. Logging
 * remains here in the domain layer so behavior is unchanged.
 */
export async function semanticSearch(
  queryEmbedding: number[],
  limit: number = 5
): Promise<ChunkRow[]> {
  const rows = await ragRepository.semanticSearch(queryEmbedding, limit);

  logEvent("RAG_SEMANTIC_SEARCH", {
    limit,
    returned: rows.length,
  });

  return rows;
}
