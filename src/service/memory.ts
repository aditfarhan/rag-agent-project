import { pool } from "../utils/db";
import { embedText } from "./embedding";

/**
 * Save memory for a user.
 * - FACT: unique per memory_key (UPSERT)
 * - CHAT: always appended
 */
export async function saveMemory(
  userId: string,
  role: string,
  content: string,
  memoryKey?: string,
  memoryType: "fact" | "chat" = "chat"
) {
  console.log("Saving memory:", { userId, role, memoryKey, memoryType });

  const embedding = await embedText(content);

  // ✅ FACT MEMORY (single value per key)
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
      [userId, role, content, JSON.stringify(embedding), memoryKey]
    );

    console.log("FACT UPSERT:", result.rows[0]);
    return result.rows[0];
  }

  // ✅ CHAT MEMORY (always append)
  const result = await pool.query(
    `
    INSERT INTO user_memories 
      (user_id, role, content, embedding, memory_key, memory_type)
    VALUES ($1, $2, $3, $4, NULL, 'chat')
    RETURNING id;
    `,
    [userId, role, content, JSON.stringify(embedding)]
  );

  console.log("CHAT MEMORY INSERTED:", result.rows[0]);
  return result.rows[0];
}

/**
 * Retrieve memories with priority:
 * 1. Fact memory
 * 2. Most recent chat memory
 */
export async function retrieveMemory(
  userId: string,
  queryEmbedding: number[],
  limit = 5
) {
  const result = await pool.query(
    `
    SELECT content, memory_type
    FROM user_memories
    WHERE user_id = $1
    ORDER BY 
      CASE 
        WHEN memory_type = 'fact' THEN 0 
        ELSE 1 
      END,
      embedding <-> $2::vector
    LIMIT $3;
    `,
    [userId, JSON.stringify(queryEmbedding), limit]
  );

  return result.rows.map((r: any) => r.content);
}
