import { pool } from "../utils/db";
import { embedText } from "./embedding";

export async function saveMemory(
  userId: string,
  role: string,
  content: string
) {
  console.log("Saving memory to DB...");
  const embedding = await embedText(content);

  console.log("Embedding length:", embedding.length);

  const result = await pool.query(
    `INSERT INTO user_memories (user_id, role, content, embedding)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [userId, role, content, `[${embedding.join(",")}]`]
  );

  console.log("Insert result:", result.rows[0]);
}

export async function retrieveMemory(
  userId: string,
  queryEmbedding: number[],
  limit = 3
) {
  const result = await pool.query(
    `SELECT content, embedding <-> $1::vector AS similarity
     FROM user_memories
     WHERE user_id = $2
     ORDER BY similarity
     LIMIT $3`,
    [`[${queryEmbedding.join(",")}]`, userId, limit]
  );

  return result.rows.map((r: any) => r.content);
}
