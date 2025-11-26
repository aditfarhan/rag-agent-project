import crypto from "crypto";
import { config } from "../config";
import { logEvent } from "../utils/logger";
import { embedText } from "./embeddingService";
import {
  getLatestFactsByKey,
  retrieveMemory,
  saveMemory,
} from "./memoryService";
import { buildContextFromChunks, getRagContextForQuery } from "./ragService";
import { callLLM } from "../service/mastraAgent";

export interface ChatRequest {
  userId: string;
  question: string;
  history?: any[];
}

export interface ChatResponseMeta {
  rag: {
    topK: number;
    distanceThreshold: number;
    chunksReturned: number;
  };
  memory: {
    similarTopK: number;
    factsCount: number;
  };
}

export interface ChatResponsePayload {
  answer: string;
  history: any[];
  contextUsed: unknown[];
  memoryUsed: boolean;
  meta: ChatResponseMeta;
}

/**
 * Extract dynamic fact + intent from user message using the LLM.
 */
async function extractDynamicKeyFact(userMessage: string): Promise<{
  key: string;
  value: string;
  intent: "introducing" | "asking" | "updating" | "neutral";
} | null> {
  const prompt = `
You are a fact extraction and intent classification engine.

Return STRICT JSON in this format ONLY:
{
  "key": "string",
  "value": "string",
  "intent": "introducing" | "updating" | "asking" | "neutral"
}

Intent definitions:
- introducing: user provides a new personal fact
- updating: user modifies an existing fact
- asking: user asks about their own stored fact
- neutral: no personal fact involved

Examples:
"My name is Aditia" -> { "key": "name", "value": "Aditia", "intent": "introducing" }
"My name is now Budi" -> { "key": "name", "value": "Budi", "intent": "updating" }
"Who am I?" -> { "key": "name", "value": "", "intent": "asking" }
"Hello there" -> null

User message: "${userMessage}"
`;

  const response = await callLLM(prompt, "", []);

  try {
    const firstBrace = response.indexOf("{");
    const jsonText = firstBrace >= 0 ? response.slice(firstBrace) : response;
    const fact = JSON.parse(jsonText);

    if (fact?.key && typeof fact.intent === "string") {
      return {
        key: String(fact.key).toLowerCase(),
        value: String(fact.value || ""),
        intent: fact.intent,
      };
    }
  } catch (err: any) {
    console.log("FACT PARSE ERROR:", err?.message || err);
  }

  return null;
}

/**
 * Core Chat Engine
 */
export async function handleChat(
  request: ChatRequest
): Promise<ChatResponsePayload> {
  const { userId, question, history = [] } = request;

  const requestId = crypto.randomUUID();
  const startTime = Date.now();

  logEvent("CHAT_REQUEST", {
    requestId,
    userId,
    question,
  });

  // 1️⃣ Extract fact + intent
  const keyFact = await extractDynamicKeyFact(question);

  if (
    keyFact &&
    (keyFact.intent === "introducing" || keyFact.intent === "updating") &&
    keyFact.value
  ) {
    await saveMemory(userId, "user", keyFact.value, keyFact.key, "fact");
  }

  // 2️⃣ Embedding
  const qEmbedding = await embedText(question);

  // 3️⃣ RAG Retrieval
  const ragResult = await getRagContextForQuery(qEmbedding);
  const ragContext = buildContextFromChunks(ragResult.finalChunks);

  // 4️⃣ Latest FACT memories
  const latestFacts = await getLatestFactsByKey(userId);
  const keyMemoryContext = latestFacts
    .map((m) => `(${m.memory_key.toUpperCase()}): ${m.content}`)
    .join("\n");

  // 5️⃣ Similar memory retrieval
  const similarTopK = config.memory.similarTopK;
  const otherMemoryResults = await retrieveMemory(
    userId,
    qEmbedding,
    similarTopK,
    "user"
  );

  const memoryText = [keyMemoryContext, ...otherMemoryResults]
    .filter(Boolean)
    .join("\n");

  logEvent("MEMORY_CONTEXT", {
    requestId,
    factCount: latestFacts.length,
    similarRetrieved: otherMemoryResults.length,
  });

  // ✅ FAST PATH: User asking personal fact
  if (keyFact?.intent === "asking" && keyFact.key) {
    const known = latestFacts.find((f) => f.memory_key === keyFact.key);

    if (known) {
      const answer = `Your ${keyFact.key} is ${known.content}.`;

      await saveMemory(userId, "assistant", answer, undefined, "chat");

      return {
        answer,
        history: [
          { role: "user", content: question },
          { role: "assistant", content: answer },
        ],
        contextUsed: [],
        memoryUsed: true,
        meta: {
          rag: {
            topK: ragResult.meta.topK,
            distanceThreshold: ragResult.meta.distanceThreshold,
            chunksReturned: 0,
          },
          memory: {
            similarTopK,
            factsCount: latestFacts.length,
          },
        },
      };
    }
  }

  // ✅ Greeting only when introducing
  if (keyFact?.intent === "introducing" && keyFact?.value && !history.length) {
    const greeting = `Hello, ${keyFact.value}! How can I assist you today?`;

    await saveMemory(userId, "assistant", greeting, undefined, "chat");

    const duration = Date.now() - startTime;

    logEvent("CHAT_RESPONSE", {
      requestId,
      userId,
      answerLength: greeting.length,
      durationMs: duration,
    });

    return {
      answer: greeting,
      history: [
        { role: "user", content: question },
        { role: "assistant", content: greeting },
      ],
      contextUsed: [],
      memoryUsed: true,
      meta: {
        rag: {
          topK: ragResult.meta.topK,
          distanceThreshold: ragResult.meta.distanceThreshold,
          chunksReturned: 0,
        },
        memory: {
          similarTopK,
          factsCount: latestFacts.length,
        },
      },
    };
  }

  // 6️⃣ Normal LLM flow
  const shouldCallLLM = ragResult.finalChunks.length > 0 || Boolean(memoryText);

  const answer = shouldCallLLM
    ? await callLLM(question, ragContext, history, memoryText)
    : "I don't know from the document.";

  await saveMemory(userId, "assistant", answer, undefined, "chat");

  const duration = Date.now() - startTime;

  logEvent("CHAT_RESPONSE", {
    requestId,
    userId,
    answerLength: answer.length,
    durationMs: duration,
  });

  return {
    answer,
    history: [
      ...history,
      { role: "user", content: question },
      { role: "assistant", content: answer },
    ],
    contextUsed: ragResult.finalChunks,
    memoryUsed: !!memoryText,
    meta: {
      rag: {
        topK: ragResult.meta.topK,
        distanceThreshold: ragResult.meta.distanceThreshold,
        chunksReturned: ragResult.meta.chunksReturned,
      },
      memory: {
        similarTopK,
        factsCount: latestFacts.length,
      },
    },
  };
}
