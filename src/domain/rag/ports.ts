import type { ChunkRow } from "./ragEngine";

/**
 * Domain port for RAG document retrieval.
 *
 * This interface captures the database/vector-store operations used by the
 * RAG engine. The current implementation in ragEngine talks directly to
 * Postgres + pgvector; future infrastructure adapters (e.g.,
 * PgVectorRagRepository) will implement this interface without changing
 * behavior.
 */
export interface RagRepository {
  /**
   * Low-level similarity query used by the RAG context builder.
   * Mirrors the behavior of queryChunksByEmbedding in ragEngine.
   */
  queryChunksByEmbedding(
    queryEmbedding: number[],
    topK: number
  ): Promise<ChunkRow[]>;

  /**
   * Vector-based semantic search over chunks.
   * Mirrors the behavior of semanticSearch in ragEngine.
   */
  semanticSearch(queryEmbedding: number[], limit?: number): Promise<ChunkRow[]>;
}
