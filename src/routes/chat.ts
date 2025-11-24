import { Router } from "express";
import { pool } from "../utils/db";
import { embedText } from "../service/embedding";
import { callLLM } from "../service/mastraAgent"; // your agent file
import { client } from "../service/openAIClient.ts";

const router = Router();

router.post("/", async (req, res) => {
  try {
    const { question, history = [] } = req.body;

    if (!question) return res.status(400).json({ error: "question required" });

    // embed and retrieve context
    const qEmbedding = await embedText(question);
    const result = await pool.query(
      `SELECT content, embedding <-> $1::vector as distance
       FROM chunks
       ORDER BY distance
       LIMIT 5`,
      [`[${qEmbedding.join(",")}]`]
    );

    const context = result.rows.map((r: any) => r.content).join("\n\n---\n\n");

    const systemPrompt = `
Answer only using the given context. 
If unavailable say "I don't know from the document".
`;

    const messagesForLLM = [
      { role: "system", content: systemPrompt },
      ...history,
      {
        role: "user",
        content: `CONTEXT:\n${context}\n\nQUESTION: ${question}`,
      },
    ];

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: messagesForLLM,
    });

    const answer = completion.choices?.[0]?.message?.content ?? "No response";

    const newHistory = [
      ...history,
      { role: "user", content: question },
      { role: "assistant", content: answer },
    ];

    res.json({
      answer,
      history: newHistory,
      contextUsed: result.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "chat failed" });
  }
});

export default router;
