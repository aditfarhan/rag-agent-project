import { Router } from "express";
import { pool } from "../utils/db";
import { embedText } from "../service/embedding";
import { callLLM } from "../service/mastraAgent";
import { saveMemory, retrieveMemory } from "../service/memory";

const router = Router();

router.post("/", async (req, res) => {
  try {
    const { question, history = [], userId } = req.body;

    if (!userId) return res.status(400).json({ error: "userId is required" });

    if (!question) {
      return res.status(400).json({ error: "question required" });
    }

    // 1) User question embedding
    const qEmbedding = await embedText(question);

    // 2) RAG document retrieval
    const result = await pool.query(
      `SELECT content, embedding <-> $1::vector AS distance
       FROM chunks
       ORDER BY distance
       LIMIT 5`,
      [`[${qEmbedding.join(",")}]`]
    );
    const ragContext = result.rows
      .map((r: any) => r.content)
      .join("\n\n---\n\n");

    // 3) Retrieve memory
    const memoryResults = await retrieveMemory(userId, qEmbedding, 3);
    const memoryContext = memoryResults.join("\n");

    // 4) Final combined context
    const finalContext = `
      MEMORY:
      ${memoryContext}

      DOCUMENT CONTEXT:
      ${ragContext}
    `;

    // 5) Generate answer
    const answer = await callLLM(question, finalContext, history);

    // 6) Save memory — user first, then assistant
    await saveMemory(userId, "user", question);
    await saveMemory(userId, "assistant", answer);

    // 7) Build history response
    const newHistory = [
      ...history,
      { role: "user", content: question },
      { role: "assistant", content: answer },
    ];

    return res.json({
      answer,
      history: newHistory,
      contextUsed: result.rows,
      memoryUsed: memoryContext !== "",
      memory: memoryResults,
    });
  } catch (err) {
    console.error("Chat error:", err);
    return res.status(500).json({ error: "chat failed" });
  }
});

export default router;
