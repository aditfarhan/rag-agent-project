import { pool } from "../utils/db";
import { embedText } from "./embedding";

// Helper: cosine similarity between two vectors
function cosineSimilarity(
  vecA: number[] | undefined,
  vecB: number[] | undefined
) {
  if (!vecA || !vecB) return 0; // treat undefined as zero similarity
  const dot = vecA.reduce((sum, val, i) => sum + val * (vecB[i] ?? 0), 0);
  const magA = Math.sqrt(vecA.reduce((sum, val) => sum + val * val, 0));
  const magB = Math.sqrt(vecB.reduce((sum, val) => sum + val * val, 0));
  if (magA === 0 || magB === 0) return 0;
  return dot / (magA * magB);
}

export async function saveMemory(
  userId: string,
  role: string,
  content: string,
  similarityThreshold = 0.9 // Only save if memory is sufficiently different
) {
  console.log("Saving memory to DB...");
  const embedding = await embedText(content);
  console.log("Embedding length:", embedding.length);

  // Retrieve all memories for this user
  const existing = await pool.query(
    `SELECT id, embedding FROM user_memories WHERE user_id = $1`,
    [userId]
  );

  // Check for duplicates
  const isDuplicate = existing.rows.some((row: any) => {
    const existingEmbedding = JSON.parse(row.embedding);
    return (
      cosineSimilarity(existingEmbedding, embedding) >= similarityThreshold
    );
  });

  if (isDuplicate) {
    console.log("Duplicate memory detected, skipping insert.");
    return null;
  }

  // Insert new memory
  const result = await pool.query(
    `INSERT INTO user_memories (user_id, role, content, embedding)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [userId, role, content, JSON.stringify(embedding)]
  );

  console.log("Memory saved:", result.rows[0]);
  return result.rows[0];
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
    [JSON.stringify(queryEmbedding), userId, limit]
  );

  return result.rows.map((r: any) => r.content);
}
