import { Router } from "express";
import { pool } from "../utils/db";
import { embedText } from "../service/embedding";
import { callLLM } from "../service/mastraAgent";

const router = Router();

router.post("/", async (req, res) => {
  try {
    const { query, userId } = req.body;

    if (!query) return res.status(400).json({ error: "query is required" });
    if (!userId) return res.status(400).json({ error: "userId is required" });

    // 1️⃣ Embed query
    const queryEmbedding = await embedText(query);

    // Convert embedding to valid pgvector format
    const embeddingVector = `[${queryEmbedding.join(",")}]`;

    // 2️⃣ Retrieve document chunks via vector similarity
    const docs = await pool.query(
      `
      SELECT
        id,
        document_id,
        chunk_index,
        content,
        1 - (embedding <=> $1) AS similarity
      FROM chunks
      ORDER BY similarity DESC
      LIMIT 5;
      `,
      [embeddingVector]
    );

    // 3️⃣ Retrieve latest user memory (user-specific context)
    const mem = await pool.query(
      `
      SELECT memory_key, content
      FROM user_memories
      WHERE user_id = $1
        AND role = 'user'
      ORDER BY updated_at DESC
      LIMIT 5;
      `,
      [userId]
    );

    const memoryContext =
      mem.rows.length > 0
        ? mem.rows
            .map((m) =>
              m.memory_key ? `${m.memory_key}: ${m.content}` : m.content
            )
            .join("\n")
        : "";

    const documentContext = docs.rows.map((r) => r.content).join("\n---\n");

    // 4️⃣ Call Mastra AI (LLM)
    const answer = await callLLM(query, documentContext, [], memoryContext);

    // ✅ Ensure safe fallback
    const finalAnswer =
      answer && answer.trim().length
        ? answer
        : "I don't know from the document.";

    // 5️⃣ Save assistant memory (UPSERT strategy)
    await pool.query(
      `
      INSERT INTO user_memories (user_id, role, content, memory_key)
      VALUES ($1, 'assistant', $2, 'last_answer')
      ON CONFLICT (user_id, memory_key)
      DO UPDATE SET content = EXCLUDED.content,
                   updated_at = NOW();
      `,
      [userId, finalAnswer]
    );

    // 6️⃣ Return final output
    return res.json({
      status: "ok",
      query,
      userId,
      answer: finalAnswer,
      memory: memoryContext,
      sources: docs.rows,
    });
  } catch (error: any) {
    console.error("RAG error:", error);
    res.status(500).json({
      error: "rag failed",
      detail: error.message,
    });
  }
});

export default router;
