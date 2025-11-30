import { pool } from "@infra/database/db";
import { toPgVectorLiteral } from "@utils/vector";

import type { RagRepository } from "@domain/rag/ports";
import type { ChunkRow } from "@domain/rag/ragEngine";

/**
 * Concrete Postgres + pgvector implementation of the RagRepository port.
 *
 * IMPORTANT: This adapter preserves the exact behavior of the previous
 * ragEngine DB access:
 * - queryChunksByEmbedding: uses embedding <-> $1::vector and orders by distance ASC.
 * - semanticSearch: uses 1 - (embedding <=> $1::vector) AS similarity and orders by
 *   similarity DESC.
 *
 * Logging and threshold logic remain inside ragEngine; this adapter only
 * performs the raw SQL queries and returns typed rows.
 */
export class PgVectorRagRepository implements RagRepository {
  /**
   * Low-level similarity query over the chunks table, ordered by distance.
   *
   * Mirrors the original queryChunksByEmbedding implementation in ragEngine.
   */
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

  /**
   * Vector-based semantic search over chunks.
   *
   * Mirrors the original semanticSearch implementation in ragEngine, but
   * without logging. Logging remains in the domain-level ragEngine wrapper.
   */
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

/**
 * Singleton instance used by the domain ragEngine.
 * This keeps wiring explicit while maintaining current behavior.
 */
export const ragRepository: RagRepository = new PgVectorRagRepository();
