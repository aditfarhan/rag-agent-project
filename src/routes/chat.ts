import { Router } from "express";
import { pool } from "../utils/db";
import { embedText } from "../service/embedding";
import { callLLM } from "../service/mastraAgent";
import { saveMemory, retrieveMemory } from "../service/memory";

const router = Router();

/**
 * Extract dynamic fact from user message via LLM
 */
async function extractDynamicKeyFact(userMessage: string) {
  const prompt = `
You are a fact extractor.
Given the user message, extract a single concise key for the fact and its corresponding value.
Respond in PURE JSON format exactly like {"key":"name","value":"Aditia Farhan"}.
If no fact can be extracted, respond with null.

User message: "${userMessage}"
`;

  const response = await callLLM(prompt, "", []);
  console.log("RAW FACT RESPONSE:", response);

  try {
    const first = response.indexOf("{");
    const jsonText = first >= 0 ? response.slice(first) : response;
    const fact = JSON.parse(jsonText);

    console.log("PARSED FACT:", fact);
    if (fact?.key && fact?.value)
      return { key: String(fact.key).toLowerCase(), value: String(fact.value) };
  } catch (err: any) {
    console.log("FACT PARSE ERROR:", err?.message || err);
  }
  return null;
}

router.post("/", async (req, res) => {
  try {
    let { question, history = [], userId } = req.body;

    if (!userId) return res.status(400).json({ error: "userId is required" });
    if (!question) return res.status(400).json({ error: "question required" });

    // Extract key fact
    const keyFact = await extractDynamicKeyFact(question);

    let memoryKey: string | undefined;
    let keyFactValue: string | undefined;

    if (keyFact?.key && keyFact?.value) {
      memoryKey = keyFact.key;
      keyFactValue = keyFact.value;

      await saveMemory(userId, "user", keyFactValue, memoryKey);
    }

    // Embedding for retrieval
    const qEmbedding = await embedText(question);

    // RAG docs
    const ragResult = await pool.query(
      `SELECT content, embedding <-> $1::vector AS distance
       FROM chunks ORDER BY distance LIMIT 5`,
      [JSON.stringify(qEmbedding)]
    );

    const ragContext = ragResult.rows
      .map((r: any) => r.content)
      .join("\n---\n");

    // Latest memory for every key
    const keyMemoryResult = await pool.query(
      `SELECT content, memory_key
       FROM user_memories u
       WHERE user_id=$1 AND memory_key IS NOT NULL AND role='user'
         AND id = (
            SELECT MAX(id)
            FROM user_memories
            WHERE user_id=$1 AND memory_key = u.memory_key
         )`,
      [userId]
    );

    const keyMemoryContext = keyMemoryResult.rows
      .map((m) => `(${m.memory_key.toUpperCase()}): ${m.content}`)
      .join("\n");

    // Similar memory via embeddings
    const otherMemoryResults = await retrieveMemory(userId, qEmbedding, 5);
    const otherMemoryContext = otherMemoryResults
      .filter((m) => typeof m === "string")
      .join("\n");

    const memoryText = `${keyMemoryContext}\n${otherMemoryContext}`.trim();

    // 🧠 FIRST MESSAGE FALLBACK LOGIC
    if (
      memoryKey &&
      keyFactValue &&
      !ragContext &&
      !otherMemoryContext &&
      !keyMemoryContext
    ) {
      const answer = `Hello, ${keyFactValue}! How can I assist you today?`;

      await saveMemory(userId, "assistant", answer);

      return res.json({
        answer,
        history: [
          { role: "user", content: question },
          { role: "assistant", content: answer },
        ],
        memoryUsed: true,
      });
    }

    // Final combined context
    const answer = await callLLM(question, ragContext, history, memoryText);

    await saveMemory(userId, "assistant", answer);

    const newHistory = [
      ...history,
      { role: "user", content: question },
      { role: "assistant", content: answer },
    ];

    return res.json({
      answer,
      history: newHistory,
      contextUsed: ragResult.rows,
      memoryUsed: memoryText !== "",
      memory: [
        ...keyMemoryResult.rows.map((r) => r.content),
        ...otherMemoryResults,
      ],
    });
  } catch (err) {
    console.error("Chat error:", err);
    return res.status(500).json({ error: "chat failed" });
  }
});

export default router;
