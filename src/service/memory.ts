import { pool } from "../utils/db";
import { embedText } from "./embedding";

/**
 * Save a memory row for a user message or assistant response.
 * If memoryKey is provided, update existing memory; otherwise insert new row.
 */
export async function saveMemory(
  userId: string,
  role: string,
  content: string,
  memoryKey?: string
) {
  console.log("Saving memory to DB...");

  const embedding = await embedText(content);
  console.log("Embedding length:", embedding.length);

  // If memoryKey provided => UPSERT to maintain single fact per key
  if (memoryKey) {
    const result = await pool.query(
      `INSERT INTO user_memories (user_id, role, content, embedding, memory_key)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, memory_key)
       DO UPDATE SET
          role = EXCLUDED.role,
          content = EXCLUDED.content,
          embedding = EXCLUDED.embedding
       RETURNING id, content, memory_key`,
      [userId, role, content, JSON.stringify(embedding), memoryKey]
    );

    console.log("UPSERT memory (fact) saved:", result.rows[0]);
    return result.rows[0];
  }

  // Otherwise → normal INSERT chat log (no key)
  const result = await pool.query(
    `INSERT INTO user_memories (user_id, role, content, embedding, memory_key)
     VALUES ($1, $2, $3, $4, NULL)
     RETURNING id`,
    [userId, role, content, JSON.stringify(embedding)]
  );

  console.log("Inserted regular chat memory:", result.rows[0]);
  return result.rows[0];
}

/**
 * Retrieve most relevant memories for a user (by embedding similarity).
 */
export async function retrieveMemory(
  userId: string,
  queryEmbedding: number[],
  limit = 3,
  roleFilter: "user" | "assistant" | "any" = "user"
) {
  const roleClause = roleFilter === "any" ? "" : `AND role = '${roleFilter}'`;

  const result = await pool.query(
    `SELECT content, embedding <-> $1::vector AS similarity
       FROM user_memories
       WHERE user_id = $2
       ${roleClause}
       ORDER BY similarity
       LIMIT $3`,
    [JSON.stringify(queryEmbedding), userId, limit]
  );

  return result.rows.map((r: any) => r.content);
}
