import { Router } from "express";
import { embedText } from "../service/embedding";
import { callLLM } from "../service/mastraAgent";
import { semanticSearch } from "../services/ragService";
import { getRecentUserMemories, saveMemory } from "../services/memoryService";

const router = Router();

/**
 * RAG route: query ingested documents with optional user-specific memory context.
 *
 * Behavior:
 * - Preserves the existing HTTP API:
 *   POST /api/rag { query, userId } -> { status, query, userId, answer, memory, sources }
 * - Uses the unified retrieval engine (services/ragService) for document chunks.
 * - Uses the centralized memory service for user memories and assistant answers.
 */
router.post("/", async (req, res) => {
  try {
    const { query, userId } = req.body;

    if (!query) {
      return res.status(400).json({ error: "query is required" });
    }
    if (!userId) {
      return res.status(400).json({ error: "userId is required" });
    }

    // 1️⃣ Embed query once
    const queryEmbedding = await embedText(query);

    // 2️⃣ Retrieve document chunks via unified semantic search
    const docs = await semanticSearch(queryEmbedding, 5);

    // 3️⃣ Retrieve latest user memory (user-specific context)
    const mem = await getRecentUserMemories(userId, 5);

    const memoryContext =
      mem.length > 0
        ? mem
            .map((m) =>
              m.memory_key ? `${m.memory_key}: ${m.content}` : m.content
            )
            .join("\n")
        : "";

    const documentContext = docs.map((r) => r.content).join("\n---\n");

    // 4️⃣ Call Mastra AI (LLM)
    const answer = await callLLM(query, documentContext, [], memoryContext);

    // ✅ Ensure safe fallback
    const finalAnswer =
      answer && answer.trim().length
        ? answer
        : "I don't know from the document.";

    // 5️⃣ Save assistant memory (UPSERT strategy) using memory service
    await saveMemory(userId, "assistant", finalAnswer, "last_answer", "fact");

    // 6️⃣ Return final output
    return res.json({
      status: "ok",
      query,
      userId,
      answer: finalAnswer,
      memory: memoryContext,
      sources: docs,
    });
  } catch (error: any) {
    console.error("RAG error:", error);
    return res.status(500).json({
      error: "rag failed",
      detail: error.message,
    });
  }
});

export default router;
