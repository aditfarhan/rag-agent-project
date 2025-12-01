/**
 * RAG (Retrieval-Augmented Generation) context retrieval engine.
 *
 * Orchestrates vector-based document search for intelligent context retrieval:
 * - Generates embeddings for user queries
 * - Performs similarity search over document chunks
 * - Applies distance thresholds for quality filtering
 * - Builds contextual prompt strings for LLM consumption
 *
 * Central coordinator for the "retrieval" component in RAG, providing relevant
 * document context to the Mastra AI agent for informed responses.
 */
import { config } from "@config/index";
import { ragRepository } from "@infrastructure/database/PgVectorRagRepository";
import { logEvent } from "@infrastructure/logging/Logger";

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

async function queryChunksByEmbedding(
  queryEmbedding: number[],
  topK: number
): Promise<ChunkRow[]> {
  return ragRepository.queryChunksByEmbedding(queryEmbedding, topK);
}

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
      typeof chunk.distance === "number" && chunk.distance <= distanceThreshold
  );

  const finalChunks = filteredChunks.length > 0 ? filteredChunks : rawChunks;

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

export function buildContextFromChunks(chunks: ChunkRow[]): string {
  if (!chunks.length) {
    return "";
  }

  return chunks.map((c) => c.content).join("\n---\n");
}

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
