/**
 * Concrete Postgres + pgvector implementation of the RagRepository port.
 *
 * Provides vector similarity search capabilities for the RAG system:
 * - Semantic document chunk retrieval using PostgreSQL + pgvector
 * - Distance-based ranking for context-aware document retrieval
 * - Optimized queries for similarity and embedding comparison
 * - Bridge between domain-level RAG logic and PostgreSQL vector storage
 *
 * Critical infrastructure component enabling the "retrieval" phase of RAG,
 * converting vector embeddings into relevant document context for LLM responses.
 */
import { pool } from "@infra/database/db";
import { toPgVectorLiteral } from "@utils/vector";

import type { RagRepository } from "@domain/rag/ports";
import type { ChunkRow } from "@domain/rag/ragEngine";

export class PgVectorRagRepository implements RagRepository {
  async queryChunksByEmbedding(
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

  async semanticSearch(
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

    return result.rows as ChunkRow[];
  }
}

export const ragRepository: RagRepository = new PgVectorRagRepository();
