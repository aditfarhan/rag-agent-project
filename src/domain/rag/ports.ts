/**
 * RAG (Retrieval-Augmented Generation) repository interface.
 *
 * Defines the contract for document chunk storage and vector search:
 * - Semantic similarity search over document embeddings
 * - Context retrieval for LLM-powered responses
 * - Distance-based and similarity-based ranking algorithms
 *
 * Essential component enabling the "R" in RAG for intelligent document retrieval.
 */
import type { ChunkRow } from "./ragEngine";

export interface RagRepository {
  queryChunksByEmbedding(
    queryEmbedding: number[],
    topK: number
  ): Promise<ChunkRow[]>;

  semanticSearch(queryEmbedding: number[], limit?: number): Promise<ChunkRow[]>;
}
