import { config } from "@config/index";
import { pool } from "@infra/database/db";
import { embedText } from "@infra/llm/EmbeddingProvider";
import { logEvent, logger } from "@infra/logging/Logger";
import { toPgVectorLiteral } from "@utils/vector";

import type {
  MemoryRole,
  MemoryType,
  SavedMemory,
} from "@domain/memory/memoryManager";
import type { MemoryRepository } from "@domain/memory/ports";

/**
 * Concrete Postgres-backed implementation of the MemoryRepository port.
 *
 * IMPORTANT: This adapter preserves the exact behavior of the previous
 * domain-level memoryManager:
 * - FACT memories are upserted per (user_id, memory_key).
 * - CHAT memories are always appended.
 * - Similarity scoring, recency scoring, and logging semantics are identical.
 */

/**
 * Internal shape used for ranking memories. Mirrors MemoryRow in memoryManager.
 */
interface MemoryRow {
  content: string;
  memory_key: string | null;
  memory_type: MemoryType;
  updated_at: Date | null;
  distance: number | null;
}

/**
 * Lazy, cached detection of the optional conversation_id column.
 *
 * - If the column exists, we can safely write/filter by conversation_id.
 * - If it does not, we fall back to the legacy behavior with no grouping.
 *
 * This keeps the repository backward-compatible with existing schemas.
 */
let conversationIdColumnChecked = false;
let conversationIdColumnExists = false;

async function ensureConversationIdColumn(): Promise<boolean> {
  if (conversationIdColumnChecked) {
    return conversationIdColumnExists;
  }

  try {
    const result = await pool.query(
      `
      SELECT 1
      FROM information_schema.columns
      WHERE table_name = 'user_memories'
        AND column_name = 'conversation_id'
      LIMIT 1;
      `
    );

    const count = result.rowCount ?? 0;
    conversationIdColumnExists = count > 0;
  } catch (error: unknown) {
    // Non-fatal: if this check fails, we simply behave as if the column
    // does not exist and preserve legacy behavior.
    const caught = error as { message?: unknown; name?: unknown };

    logEvent("MEMORY_CONVERSATION_COLUMN_CHECK_FAILED", {
      message:
        typeof caught.message === "string" ? caught.message : String(error),
      name: typeof caught.name === "string" ? caught.name : undefined,
    });
    conversationIdColumnExists = false;
  } finally {
    conversationIdColumnChecked = true;
  }

  return conversationIdColumnExists;
}

export class PostgresMemoryRepository implements MemoryRepository {
  /**
   * Save a memory entry for a user.
   *
   * Behavior is identical to the original saveMemory implementation in
   * memoryManager:
   * - FACT: unique per memory_key (UPSERT semantics).
   * - CHAT: always appended.
   */
  async saveMemory(
    userId: string,
    role: string,
    content: string,
    memoryKey?: string,
    memoryType: MemoryType = "chat",
    conversationId?: number | null
  ): Promise<SavedMemory> {
    const embedding = await embedText(content);
    const vectorLiteral = toPgVectorLiteral(embedding);

    const hasConversationColumn =
      conversationId !== null &&
      conversationId !== undefined &&
      (await ensureConversationIdColumn());

    if (memoryType === "fact" && memoryKey) {
      let result;

      if (hasConversationColumn) {
        result = await pool.query(
          `
          INSERT INTO user_memories
            (user_id, role, content, embedding, memory_key, memory_type, conversation_id)
          VALUES ($1, $2, $3, $4, $5, 'fact', $6)
          ON CONFLICT (user_id, memory_key)
          DO UPDATE SET
            content = EXCLUDED.content,
            embedding = EXCLUDED.embedding,
            updated_at = NOW()
          RETURNING id, content, memory_key;
          `,
          [userId, role, content, vectorLiteral, memoryKey, conversationId]
        );
      } else {
        // Legacy behavior without conversation grouping.
        result = await pool.query(
          `
          INSERT INTO user_memories
            (user_id, role, content, embedding, memory_key, memory_type)
          VALUES ($1, $2, $3, $4, $5, 'fact')
          ON CONFLICT (user_id, memory_key)
          DO UPDATE SET
            content = EXCLUDED.content,
            embedding = EXCLUDED.embedding,
            updated_at = NOW()
          RETURNING id, content, memory_key;
          `,
          [userId, role, content, vectorLiteral, memoryKey]
        );
      }

      const saved = result.rows[0] as SavedMemory;

      logEvent("MEMORY_SAVE_FACT", {
        userId,
        role,
        memoryKey,
        memoryType,
        memoryId: saved.id,
      });

      if (hasConversationColumn) {
        logger.log("info", "MEMORY_SAVED", {
          userId,
          memoryKey,
          conversationId,
          memoryId: saved.id,
        });
      }

      return saved;
    }

    let result;

    if (hasConversationColumn) {
      result = await pool.query(
        `
        INSERT INTO user_memories
          (user_id, role, content, embedding, memory_key, memory_type, conversation_id)
        VALUES ($1, $2, $3, $4, NULL, 'chat', $5)
        RETURNING id, content, memory_key;
        `,
        [userId, role, content, vectorLiteral, conversationId]
      );
    } else {
      // Legacy behavior without conversation grouping.
      result = await pool.query(
        `
        INSERT INTO user_memories
          (user_id, role, content, embedding, memory_key, memory_type)
        VALUES ($1, $2, $3, $4, NULL, 'chat')
        RETURNING id, content, memory_key;
        `,
        [userId, role, content, vectorLiteral]
      );
    }

    const saved = result.rows[0] as SavedMemory;

    logEvent("MEMORY_SAVE_CHAT", {
      userId,
      role,
      memoryType,
      memoryId: saved.id,
    });

    if (hasConversationColumn) {
      logger.log("info", "MEMORY_SAVED", {
        userId,
        memoryKey: null,
        conversationId,
        memoryId: saved.id,
      });
    }

    return saved;
  }

  /**
   * Intelligent memory retrieval with similarity + recency scoring.
   *
   * Behavior is preserved from the original retrieveMemory implementation:
   * - Fetch more candidates from DB
   * - Score each memory:
   *   score = similarity*0.6 + recency*0.3 + typeBoost
   * - Return top `limit` most valuable memories
   */
  async retrieveMemory(
    userId: string,
    queryEmbedding: number[],
    limit: number = config.memory.similarTopK,
    role: MemoryRole | "any" = "user",
    conversationId?: number | null
  ): Promise<string[]> {
    const vectorLiteral = toPgVectorLiteral(queryEmbedding);
    const candidateLimit = Math.max(limit * 3, limit);

    const useConversationFilter =
      conversationId !== null &&
      conversationId !== undefined &&
      (await ensureConversationIdColumn());

    let result;

    if (!useConversationFilter) {
      const roleClause = role === "any" ? "" : `AND role = '${role}'`;

      result = await pool.query(
        `
        SELECT
          content,
          memory_key,
          memory_type,
          updated_at,
          embedding <-> $2::vector AS distance
        FROM user_memories
        WHERE user_id = $1
          ${roleClause}
        ORDER BY embedding <-> $2::vector
        LIMIT $3;
        `,
        [userId, vectorLiteral, candidateLimit]
      );
    } else {
      const baseQuery = `
        SELECT
          content,
          memory_key,
          memory_type,
          updated_at,
          embedding <-> $3::vector AS distance
        FROM user_memories
        WHERE user_id = $1
          AND conversation_id = $2
      `;

      if (role === "any") {
        result = await pool.query(
          `
          ${baseQuery}
          ORDER BY embedding <-> $3::vector
          LIMIT $4;
          `,
          [userId, conversationId, vectorLiteral, candidateLimit]
        );
      } else {
        result = await pool.query(
          `
          ${baseQuery}
          AND role = $4
          ORDER BY embedding <-> $3::vector
          LIMIT $5;
          `,
          [userId, conversationId, vectorLiteral, role, candidateLimit]
        );
      }
    }

    const now = Date.now();
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

    const rows: MemoryRow[] = result.rows.map((row: MemoryRow) => ({
      content: row.content,
      memory_key: row.memory_key,
      memory_type: row.memory_type,
      updated_at: row.updated_at,
      distance: row.distance,
    }));

    const scored = rows.map((row) => {
      let similarity = 0;
      if (typeof row.distance === "number") {
        similarity = Math.max(0, Math.min(1, 1 - row.distance));
      }

      let recency = 0.5;
      if (row.updated_at) {
        const ageRatio =
          (now - new Date(row.updated_at).getTime()) / THIRTY_DAYS_MS;
        recency = Math.max(0, Math.min(1, 1 - ageRatio));
      }

      const typeBoost = row.memory_type === "fact" ? 0.2 : 0;

      return {
        ...row,
        score: similarity * 0.6 + recency * 0.3 + typeBoost,
      };
    });

    scored.sort((a, b) => b.score - a.score);

    const memories = scored.slice(0, limit).map((m) => m.content);

    logEvent("MEMORY_RETRIEVE_INTELLIGENT", {
      userId,
      role,
      limit,
      candidateLimit,
      totalCandidates: rows.length,
      returned: memories.length,
    });

    return memories;
  }

  /**
   * Retrieve the latest FACT memories per key for a user.
   * Behavior is identical to getLatestFactsByKey in memoryManager.
   */
  async getLatestFactsByKey(
    userId: string,
    conversationId?: number | null
  ): Promise<{ memory_key: string; content: string }[]> {
    const useConversationFilter =
      conversationId !== null &&
      conversationId !== undefined &&
      (await ensureConversationIdColumn());

    const result = useConversationFilter
      ? await pool.query(
          `
          SELECT content, memory_key
          FROM user_memories u
          WHERE user_id = $1
            AND memory_key IS NOT NULL
            AND conversation_id = $2
            AND id = (
              SELECT MAX(id)
              FROM user_memories
              WHERE user_id = $1
                AND memory_key = u.memory_key
                AND conversation_id = $2
            );
          `,
          [userId, conversationId]
        )
      : await pool.query(
          `
          SELECT content, memory_key
          FROM user_memories u
          WHERE user_id = $1
            AND memory_key IS NOT NULL
            AND id = (
              SELECT MAX(id)
              FROM user_memories
              WHERE user_id = $1 AND memory_key = u.memory_key
            );
          `,
          [userId]
        );

    logEvent("MEMORY_FACTS_LATEST", {
      userId,
      factsCount: result.rows.length,
    });

    return result.rows.map((row: { memory_key: string; content: string }) => ({
      memory_key: row.memory_key,
      content: row.content,
    }));
  }

  /**
   * Retrieve recent user memories ordered by latest update.
   * Behavior is identical to getRecentUserMemories in memoryManager.
   */
  async getRecentUserMemories(
    userId: string,
    limit = 5,
    conversationId?: number | null
  ): Promise<{ memory_key: string | null; content: string }[]> {
    const useConversationFilter =
      conversationId !== null &&
      conversationId !== undefined &&
      (await ensureConversationIdColumn());

    const result = useConversationFilter
      ? await pool.query(
          `
          SELECT memory_key, content
          FROM user_memories
          WHERE user_id = $1
            AND role = 'user'
            AND conversation_id = $3
          ORDER BY updated_at DESC
          LIMIT $2;
          `,
          [userId, limit, conversationId]
        )
      : await pool.query(
          `
          SELECT memory_key, content
          FROM user_memories
          WHERE user_id = $1
            AND role = 'user'
          ORDER BY updated_at DESC
          LIMIT $2;
          `,
          [userId, limit]
        );

    return result.rows.map(
      (row: { memory_key: string | null; content: string }) => ({
        memory_key: row.memory_key,
        content: row.content,
      })
    );
  }
}

/**
 * Singleton instance used by the domain memoryManager.
 * This keeps wiring explicit while maintaining current behavior.
 */
export const memoryRepository: MemoryRepository =
  new PostgresMemoryRepository();
