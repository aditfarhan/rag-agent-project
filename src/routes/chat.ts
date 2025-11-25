// src/routes/chat.ts
import { Router } from "express";
import { pool } from "../utils/db";
import { embedText } from "../service/embedding";
import { callLLM } from "../service/mastraAgent";
import { saveMemory, retrieveMemory } from "../service/memory";

const router = Router();

/**
 * Extract dynamic fact from user message via LLM
 * Example output: { key: "name", value: "Aditia Falah" }
 */
async function extractDynamicKeyFact(userMessage: string) {
  const prompt = `
You are a fact extractor.
Given the user message, extract a single concise key for the fact and its corresponding value.
Respond in PURE JSON format exactly like {"key":"name","value":"Aditia Farhan"}.
If no fact can be extracted, respond with null.

User message: "${userMessage}"
`;

  const response = await callLLM(
    prompt,
    "", // no document context
    [] // no history
  );

  console.log("RAW FACT RESPONSE:", response);

  try {
    const first = response.indexOf("{");
    const jsonText = first >= 0 ? response.slice(first) : response;
    const fact = JSON.parse(jsonText);

    console.log("PARSED FACT:", fact);
    if (fact?.key && fact?.value) {
      return {
        key: String(fact.key).toLowerCase(),
        value: String(fact.value),
      };
    }
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

    // 1️⃣ Extract & upsert key fact (user memory)
    const keyFact = await extractDynamicKeyFact(question);
    let memoryKey: string | undefined;
    let keyFactValue: string | undefined;

    if (keyFact?.key && keyFact?.value) {
      memoryKey = keyFact.key;
      keyFactValue = keyFact.value;

      // UPSERT one row per (user_id, memory_key)
      await saveMemory(userId, "user", keyFactValue, memoryKey);
    }

    // 2️⃣ Embed user question
    const qEmbedding = await embedText(question);
    const qVectorLiteral = `[${qEmbedding.join(",")}]`;

    // 3️⃣ RAG: retrieve relevant document chunks
    const topK = 5;
    const distanceThreshold = 1.2; // fairly loose; we’ll filter but rarely drop all

    const ragResult = await pool.query(
      `
      SELECT
        content,
        embedding <-> $1::vector AS distance
      FROM chunks
      ORDER BY distance ASC
      LIMIT $2;
      `,
      [qVectorLiteral, topK]
    );

    // optionally filter by distance if you want
    const filteredChunks = ragResult.rows.filter(
      (r: any) => r.distance <= distanceThreshold
    );

    const ragContext = (
      filteredChunks.length > 0 ? filteredChunks : ragResult.rows
    ) // fallback: use whatever we got
      .map((r: any) => r.content)
      .join("\n---\n");

    // 4️⃣ Load latest "fact" memories (one per key)
    const keyMemoryResult = await pool.query(
      `
      SELECT content, memory_key
      FROM user_memories u
      WHERE user_id = $1
        AND memory_key IS NOT NULL
        AND role = 'user'
        AND id = (
          SELECT MAX(id)
          FROM user_memories
          WHERE user_id = $1
            AND memory_key = u.memory_key
        );
      `,
      [userId]
    );

    const keyMemoryContext = keyMemoryResult.rows
      .map((m) =>
        m.memory_key
          ? `(${m.memory_key.toUpperCase()}): ${m.content}`
          : m.content
      )
      .join("\n");

    // 5️⃣ Similar memories by embedding (user-side memories only)
    const similarTopK = 5;
    const otherMemoryResults = await retrieveMemory(
      userId,
      qEmbedding,
      similarTopK,
      "user"
    );
    const otherMemoryContext = otherMemoryResults
      .filter((m) => typeof m === "string")
      .join("\n");

    const memoryText = [keyMemoryContext, otherMemoryContext]
      .filter(Boolean)
      .join("\n");

    // 6️⃣ Special case: first interaction with a new NAME fact
    if (keyFactValue && !history.length && keyMemoryContext) {
      const answer = `Hello, ${keyFactValue}! How can I assist you today?`;
      await saveMemory(userId, "assistant", answer);

      return res.json({
        answer,
        history: [
          { role: "user", content: question },
          { role: "assistant", content: answer },
        ],
        contextUsed: [],
        memoryUsed: true,
        memory: [keyFactValue],
        meta: {
          rag: { topK, distanceThreshold, chunksReturned: 0 },
          memory: { similarTopK, factsCount: keyMemoryResult.rows.length },
        },
      });
    }

    // 7️⃣ Normal flow: call Mastra agent with MEMORY + RAG context
    const answer = await callLLM(question, ragContext, history, memoryText);

    // store assistant message as memory (no memory_key => treated as chat log)
    await saveMemory(userId, "assistant", answer);

    const newHistory = [
      ...history,
      { role: "user", content: question },
      { role: "assistant", content: answer },
    ];

    return res.json({
      answer,
      history: newHistory,
      contextUsed: filteredChunks,
      memoryUsed: memoryText !== "",
      memory: [
        ...keyMemoryResult.rows.map((r) => r.content),
        ...otherMemoryResults,
      ],
      meta: {
        rag: {
          topK,
          distanceThreshold,
          chunksReturned: filteredChunks.length || ragResult.rows.length,
        },
        memory: {
          similarTopK,
          factsCount: keyMemoryResult.rows.length,
        },
      },
    });
  } catch (err) {
    console.error("Chat error:", err);
    return res.status(500).json({ error: "chat failed" });
  }
});

export default router;
