import { pool } from "../utils/db";
import { embedText } from "./embeddingService";
import { logEvent } from "../utils/logger";
import { config } from "../config";
import { toPgVectorLiteral } from "../utils/vector";

export type MemoryType = "fact" | "chat";
export type MemoryRole = "user" | "assistant";

export interface SavedMemory {
  id: number;
  content: string;
  memory_key: string | null;
}

/**
 * Save a memory entry for a user.
 *
 * - FACT: unique per memory_key (UPSERT semantics).
 * - CHAT: always appended.
 */
export async function saveMemory(
  userId: string,
  role: string,
  content: string,
  memoryKey?: string,
  memoryType: MemoryType = "chat"
): Promise<SavedMemory> {
  const embedding = await embedText(content);
  const vectorLiteral = toPgVectorLiteral(embedding);

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
        updated_at = NOW()
      RETURNING id, content, memory_key;
      `,
      [userId, role, content, vectorLiteral, memoryKey]
    );

    logEvent("MEMORY_SAVE_FACT", {
      userId,
      role,
      memoryKey,
      memoryType,
      memoryId: result.rows[0].id,
    });

    return result.rows[0];
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

  logEvent("MEMORY_SAVE_CHAT", {
    userId,
    role,
    memoryType,
    memoryId: result.rows[0].id,
  });

  return result.rows[0];
}

/**
 * Internal shape used for ranking memories.
 */
interface MemoryRow {
  content: string;
  memory_key: string | null;
  memory_type: MemoryType;
  updated_at: Date | null;
  distance: number | null;
}

/**
 * INTELLIGENT MEMORY RETRIEVAL
 *
 * Upgraded behavior:
 * - Fetch more candidates from DB
 * - Score each memory:
 *   score = similarity*0.6 + recency*0.3 + typeBoost
 * - Return top `limit` most valuable memories
 */
export async function retrieveMemory(
  userId: string,
  queryEmbedding: number[],
  limit = config.memory.similarTopK,
  role: MemoryRole | "any" = "user"
): Promise<string[]> {
  const roleClause = role === "any" ? "" : `AND role = '${role}'`;
  const vectorLiteral = toPgVectorLiteral(queryEmbedding);

  const candidateLimit = Math.max(limit * 3, limit);

  const result = await pool.query(
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

  const now = Date.now();
  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

  const rows: MemoryRow[] = result.rows.map((row: any) => ({
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

  logEvent("MEMORY_FACTS_LATEST", {
    userId,
    factsCount: result.rows.length,
  });

  return result.rows.map((row) => ({
    memory_key: row.memory_key,
    content: row.content,
  }));
}

/**
 * Retrieve recent user memories ordered by latest update.
 */
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

  return result.rows.map((row: any) => ({
    memory_key: row.memory_key,
    content: row.content,
  }));
}
