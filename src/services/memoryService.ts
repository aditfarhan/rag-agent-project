import { pool } from "../utils/db";
import { embedText } from "./embeddingService";
import { logEvent } from "../utils/logger";
import { config } from "../config";

export type MemoryType = "fact" | "chat";
export type MemoryRole = "user" | "assistant";

export interface SavedMemory {
  id: number;
  content: string;
  memory_key: string | null;
}

export interface RetrieveMemoryOptions {
  userId: string;
  queryEmbedding: number[];
  limit?: number;
  role?: MemoryRole | "any";
}

/**
 * Memory Service
 *
 * Responsibilities:
 * - Manage user-specific memories as vector-indexed records.
 * - Separate FACT memory (keyed, upserted) from CHAT memory (append-only).
 * - Provide retrieval APIs optimized for RAG + conversational context.
 *
 * Design:
 * - FACT memories: one value per (userId, memoryKey), upserted with latest content & embedding.
 * - CHAT memories: append-only timeline, retrievable by vector similarity.
 * - Both types are stored in `user_memories` with a `memory_type` discriminator.
 *
 * Memory aging suggestion:
 * - To avoid unbounded growth of CHAT history, you can introduce:
 *   - a max window per user (e.g. last N chat entries),
 *   - or a time-based decay/archival policy, implemented as periodic cleanup jobs
 *     that down-sample or delete old CHAT rows beyond some threshold.
 */

/**
 * Save a memory entry for a user.
 *
 * - FACT: unique per memory_key (UPSERT semantics).
 * - CHAT: always appended.
 *
 * This preserves the original `saveMemory` API shape while hardening semantics.
 */
export async function saveMemory(
  userId: string,
  role: string,
  content: string,
  memoryKey?: string,
  memoryType: MemoryType = "chat"
): Promise<SavedMemory> {
  const embedding = await embedText(content);

  const vectorLiteral = `[${embedding.join(",")}]`;

  if (memoryType === "fact" && memoryKey) {
    const result = await pool.query(
      `
      INSERT INTO user_memories 
        (user_id, role, content, embedding, memory_key, memory_type)
      VALUES ($1, $2, $3, $4, $5, 'fact')
      ON CONFLICT (user_id, memory_key)
      DO UPDATE SET
        content = EXCLUDED.content,
        embedding = EXCLUDED.embedding,
        memory_type = 'fact',
        updated_at = NOW()
      RETURNING id, content, memory_key;
      `,
      [userId, role, content, vectorLiteral, memoryKey]
    );

    const saved: SavedMemory = result.rows[0];

    logEvent("MEMORY_SAVE_FACT", {
      userId,
      role,
      memoryKey,
      memoryType,
      memoryId: saved.id,
    });

    return saved;
  }

  const result = await pool.query(
    `
    INSERT INTO user_memories 
      (user_id, role, content, embedding, memory_key, memory_type)
    VALUES ($1, $2, $3, $4, NULL, 'chat')
    RETURNING id, content, memory_key;
    `,
    [userId, role, content, vectorLiteral]
  );

  const saved: SavedMemory = result.rows[0];

  logEvent("MEMORY_SAVE_CHAT", {
    userId,
    role,
    memoryType,
    memoryId: saved.id,
  });

  return saved;
}

/**
 * Retrieve memories for a user, prioritizing:
 * 1. FACT memories (keyed, upserted).
 * 2. CHAT memories (vector similarity).
 *
 * This mirrors and extends the original `retrieveMemory` behavior.
 */
export async function retrieveMemory(
  userId: string,
  queryEmbedding: number[],
  limit = config.memory.similarTopK,
  role: MemoryRole | "any" = "user"
): Promise<string[]> {
  const roleClause = role === "any" ? "" : `AND role = '${role}'`;

  const vectorLiteral = `[${queryEmbedding.join(",")}]`;

  const result = await pool.query(
    `
    SELECT content, memory_key, memory_type
    FROM user_memories
    WHERE user_id = $1
      ${roleClause}
    ORDER BY
      CASE
        WHEN memory_key IS NOT NULL THEN 0
        ELSE 1
      END,
      embedding <-> $2::vector
    LIMIT $3;
    `,
    [userId, vectorLiteral, limit]
  );

  const memories = result.rows.map((r: any) => r.content as string);

  logEvent("MEMORY_RETRIEVE", {
    userId,
    role,
    limit,
    returned: memories.length,
  });

  return memories;
}

/**
 * Retrieve the latest FACT memories per key for a user.
 *
 * This centralizes the logic that was previously embedded in the chat route.
 */
export async function getLatestFactsByKey(
  userId: string
): Promise<{ memory_key: string; content: string }[]> {
  const result = await pool.query(
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

  const facts = result.rows.map((row: any) => ({
    memory_key: row.memory_key as string,
    content: row.content as string,
  }));

  logEvent("MEMORY_FACTS_LATEST", {
    userId,
    factsCount: facts.length,
  });

  return facts;
}

export async function getRecentUserMemories(
  userId: string,
  limit = 5
): Promise<{ memory_key: string | null; content: string }[]> {
  const result = await pool.query(
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

  const memories = result.rows.map((row: any) => ({
    memory_key:
      typeof row.memory_key === "string" ? (row.memory_key as string) : null,
    content: row.content as string,
  }));

  logEvent("MEMORY_RECENT_USER", {
    userId,
    limit,
    returned: memories.length,
  });

  return memories;
}
