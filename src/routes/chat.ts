// src/routes/chat.ts
import { Router } from "express";
import { pool } from "../utils/db";
import { embedText } from "../service/embedding";
import { callLLM } from "../service/mastraAgent";
import { saveMemory, retrieveMemory } from "../service/memory";
import { config } from "../config";
import { logEvent } from "../utils/logger";
import crypto from "crypto";

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
  try {
    const first = response.indexOf("{");
    const jsonText = first >= 0 ? response.slice(first) : response;
    const fact = JSON.parse(jsonText);

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

    const requestId = crypto.randomUUID();
    const startTime = Date.now();

    logEvent("CHAT_REQUEST", {
      requestId,
      userId,
      question,
    });

    const keyFact = await extractDynamicKeyFact(question);

    if (keyFact?.key && keyFact?.value) {
      await saveMemory(userId, "user", keyFact.value, keyFact.key);
    }

    // ✅ Embedding
    const qEmbedding = await embedText(question);
    const qVectorLiteral = `[${qEmbedding.join(",")}]`;

    // ✅ CONFIG-DRIVEN RAG
    const { topK, distanceThreshold } = config.rag;

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

    const filteredChunks = ragResult.rows.filter(
      (r: any) => r.distance <= distanceThreshold
    );

    const finalChunks =
      filteredChunks.length > 0 ? filteredChunks : ragResult.rows;

    logEvent("RAG_RESULT", {
      requestId,
      topK,
      distanceThreshold,
      chunksReturned: finalChunks.length,
    });

    const ragContext = finalChunks.map((r: any) => r.content).join("\n---\n");

    // ✅ Get stored fact memories
    const keyMemoryResult = await pool.query(
      `
      SELECT content, memory_key
      FROM user_memories u
      WHERE user_id=$1
        AND memory_key IS NOT NULL
        AND role='user'
        AND id = (
          SELECT MAX(id)
          FROM user_memories
          WHERE user_id=$1 AND memory_key = u.memory_key
        );
      `,
      [userId]
    );

    const keyMemoryContext = keyMemoryResult.rows
      .map((m) => `(${m.memory_key.toUpperCase()}): ${m.content}`)
      .join("\n");

    // ✅ Similar memory via vectors
    const similarTopK = config.memory.similarTopK;
    const otherMemoryResults = await retrieveMemory(
      userId,
      qEmbedding,
      similarTopK
    );

    logEvent("MEMORY_CONTEXT", {
      requestId,
      factCount: keyMemoryResult.rows.length,
      similarRetrieved: otherMemoryResults.length,
    });

    const memoryText = [keyMemoryContext, ...otherMemoryResults]
      .filter(Boolean)
      .join("\n");

    // ✅ First-time greeting logic
    if (keyFact?.value && !history.length && keyMemoryContext) {
      const greeting = `Hello, ${keyFact.value}! How can I assist you today?`;
      await saveMemory(userId, "assistant", greeting);

      const duration = Date.now() - startTime;

      logEvent("CHAT_RESPONSE", {
        requestId,
        userId,
        answerLength: greeting.length,
        durationMs: duration,
      });

      return res.json({
        answer: greeting,
        history: [
          { role: "user", content: question },
          { role: "assistant", content: greeting },
        ],
        meta: {
          rag: { topK, distanceThreshold, chunksReturned: 0 },
          memory: { factsCount: keyMemoryResult.rows.length },
        },
      });
    }

    // ✅ Decide LLM path
    const answer =
      finalChunks.length > 0 || memoryText
        ? await callLLM(question, ragContext, history, memoryText)
        : "I don't know from the document.";

    await saveMemory(userId, "assistant", answer);

    const newHistory = [
      ...history,
      { role: "user", content: question },
      { role: "assistant", content: answer },
    ];

    const duration = Date.now() - startTime;

    logEvent("CHAT_RESPONSE", {
      requestId,
      userId,
      answerLength: answer.length,
      durationMs: duration,
    });

    return res.json({
      answer,
      history: newHistory,
      contextUsed: finalChunks,
      memoryUsed: !!memoryText,
      meta: {
        rag: {
          topK,
          distanceThreshold,
          chunksReturned: finalChunks.length,
        },
        memory: {
          similarTopK,
          factsCount: keyMemoryResult.rows.length,
        },
      },
    });
  } catch (err: any) {
    err.statusCode = 500;
    err.message = "Chat processing failed";
    throw err; // Pass to global middleware
  }
});

export default router;
