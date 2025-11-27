import { pool } from "../utils/db";
import { config } from "../config";
import { logEvent } from "../utils/logger";
import { toPgVectorLiteral } from "../utils/vector";

/**
 * RAG Retrieval Service
 *
 * Responsibilities:
 * - Provide a single, centralized retrieval engine for document chunks.
 * - Encapsulate vector similarity queries against the `chunks` table.
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
 * This function uses the `<->` operator directly and does not apply any
 * post-filtering. It is intended for internal use by higher-level helpers.
 */
async function queryChunksByEmbedding(
  queryEmbedding: number[],
  topK: number
): Promise<ChunkRow[]> {
  const vectorLiteral = toPgVectorLiteral(queryEmbedding);

  const result = await pool.query(
    `
    SELECT
      id,
      document_id,
      chunk_index,
      content,
      embedding <-> $1::vector AS distance
    FROM chunks
    ORDER BY distance ASC
    LIMIT $2;
    `,
    [vectorLiteral, topK]
  );

  return result.rows as ChunkRow[];
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

  const context = finalChunks.map((c) => c.content).join("\n---\n");

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
 * This keeps the /api/search behavior but routes it through the unified
 * retrieval engine for consistency and observability.
 */
export async function semanticSearch(
  queryEmbedding: number[],
  limit: number = 5
): Promise<ChunkRow[]> {
  const vectorLiteral = toPgVectorLiteral(queryEmbedding);

  const result = await pool.query(
    `
    SELECT
      id,
      document_id,
      chunk_index,
      content,
      1 - (embedding <=> $1::vector) AS similarity
    FROM chunks
    ORDER BY similarity DESC
    LIMIT $2;
    `,
    [vectorLiteral, limit]
  );

  const rows = result.rows as ChunkRow[];

  logEvent("RAG_SEMANTIC_SEARCH", {
    limit,
    returned: rows.length,
  });

  return rows;
}
