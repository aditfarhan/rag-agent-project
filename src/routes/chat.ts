import { Router } from "express";
import { pool } from "../utils/db";
import { embedText } from "../service/embedding";
import { callLLM } from "../service/mastraAgent";

const router = Router();

router.post("/", async (req, res) => {
  try {
    const { question, history = [] } = req.body;

    if (!question) {
      return res.status(400).json({ error: "question required" });
    }

    // --- 1) Get embedding of the input question ---
    const qEmbedding = await embedText(question);

    // --- 2) Retrieve similar vectors from Postgres using pgvector ---
    const result = await pool.query(
      `SELECT content, embedding <-> $1::vector AS distance
       FROM chunks
       ORDER BY distance
       LIMIT 5`,
      [`[${qEmbedding.join(",")}]`]
    );

    const context = result.rows.map((r: any) => r.content).join("\n\n---\n\n");

    // --- 3) Call Mastra LLM Agent ---
    const answer = await callLLM(question, context, history);

    // --- 4) Update chat history with the latest exchange ---
    const newHistory = [
      ...history,
      { role: "user", content: question },
      { role: "assistant", content: answer },
    ];

    // --- 5) Return formatted response ---
    return res.json({
      answer,
      history: newHistory,
      contextUsed: result.rows,
    });
  } catch (err) {
    console.error("Chat error:", err);
    return res.status(500).json({ error: "chat failed" });
  }
});

export default router;
