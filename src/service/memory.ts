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
  memoryKey?: string // optional key to overwrite
) {
  console.log("Saving memory to DB...");
  const embedding = await embedText(content);
  console.log("Embedding length:", embedding.length);

  if (memoryKey) {
    // Check if memory with this key already exists for user
    const existing = await pool.query(
      `SELECT id FROM user_memories WHERE user_id = $1 AND memory_key = $2`,
      [userId, memoryKey]
    );

    if (existing.rows.length > 0) {
      // Update existing memory
      const result = await pool.query(
        `UPDATE user_memories
           SET role=$1, content=$2, embedding=$3
           WHERE user_id=$4 AND memory_key=$5
           RETURNING id`,
        [role, content, JSON.stringify(embedding), userId, memoryKey]
      );
      console.log("Memory updated:", result.rows[0]);
      return result.rows[0];
    }
  }

  // Insert new memory
  const result = await pool.query(
    `INSERT INTO user_memories (user_id, role, content, embedding, memory_key)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [userId, role, content, JSON.stringify(embedding), memoryKey || null]
  );
  console.log("Memory saved:", result.rows[0]);
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
