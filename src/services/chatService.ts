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
import { callLLM } from "./mastraAgent";
import { IDENTITY_KEYS } from "../config/memoryKeys";

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

  const trimmedQuestion = question.trim();
  const normalizedQuestion = trimmedQuestion.toLowerCase();

  /**
   * 1) HARD WIRES (NO LLM, NO RAG)
   *    - "My name is X"
   *    - "I like X" / "I now like X"
   *    - "What do I like?"
   */

  // 1.a Manual identity introduction: "My name is Farhan"
  const nameMatch = trimmedQuestion.match(/\bmy name is\s+(.+)/i);
  if (nameMatch && nameMatch[1]) {
    const name = nameMatch[1].trim().replace(/[.!?,]+$/, "");

    // Save user identity memory
    await saveMemory(userId, "user", name, "name", "fact");

    const greeting = `Hello, ${name}! How can I assist you today?`;

    await saveMemory(userId, "assistant", greeting, undefined, "chat");

    return {
      answer: greeting,
      history: [
        { role: "user", content: question },
        { role: "assistant", content: greeting },
      ],
      contextUsed: [], // ✅ absolutely no RAG
      memoryUsed: true,
      meta: {
        rag: { topK: 0, distanceThreshold: 0, chunksReturned: 0 },
        memory: {
          similarTopK: config.memory.similarTopK,
          factsCount: 1,
        },
      },
    };
  }

  // 1.b Manual preference introduction: "I like coffee" / "I now like tea"
  const likeMatch = trimmedQuestion.match(/^i\s+(now\s+)?like\s+(.+)/i);
  if (likeMatch && likeMatch[2]) {
    const pref = likeMatch[2].trim().replace(/[.!?,]+$/, "");

    await saveMemory(userId, "user", pref, "preference", "fact");

    const response = `Got it! I'll remember that you like ${pref}.`;

    await saveMemory(userId, "assistant", response, undefined, "chat");

    return {
      answer: response,
      history: [
        { role: "user", content: question },
        { role: "assistant", content: response },
      ],
      contextUsed: [], // ✅ No RAG
      memoryUsed: true,
      meta: {
        rag: { topK: 0, distanceThreshold: 0, chunksReturned: 0 },
        memory: {
          similarTopK: config.memory.similarTopK,
          factsCount: 1,
        },
      },
    };
  }

  // 1.c SPECIAL CASE: "What do I like?" = PURE PREFERENCE RECALL, NO RAG
  if (
    normalizedQuestion === "what do i like" ||
    normalizedQuestion === "what do i like?"
  ) {
    const latestFacts = await getLatestFactsByKey(userId);
    const prefs = latestFacts.filter(
      (f) => !IDENTITY_KEYS.includes(f.memory_key)
    );

    if (prefs.length) {
      const list = prefs.map((f) => f.content).join(" and ");
      const answer = `Your preferences include ${list}.`;

      await saveMemory(userId, "assistant", answer, undefined, "chat");

      return {
        answer,
        history: [
          { role: "user", content: question },
          { role: "assistant", content: answer },
        ],
        contextUsed: [], // ❗ no RAG
        memoryUsed: true,
        meta: {
          rag: { topK: 0, distanceThreshold: 0, chunksReturned: 0 },
          memory: {
            similarTopK: config.memory.similarTopK,
            factsCount: latestFacts.length,
          },
        },
      };
    }

    const fallback = "I don't have any stored preferences yet.";

    await saveMemory(userId, "assistant", fallback, undefined, "chat");

    return {
      answer: fallback,
      history: [
        { role: "user", content: question },
        { role: "assistant", content: fallback },
      ],
      contextUsed: [],
      memoryUsed: false,
      meta: {
        rag: { topK: 0, distanceThreshold: 0, chunksReturned: 0 },
        memory: {
          similarTopK: config.memory.similarTopK,
          factsCount: 0,
        },
      },
    };
  }

  /**
   * 2) DYNAMIC FACT + INTENT FROM LLM
   *    (for other cases: "Who am I?", compound questions, etc.)
   */
  const keyFact = await extractDynamicKeyFact(question);

  const containsPolicyIntent =
    /policy|company|work|acceptable|allowed|forbidden|break|rule|regulation/i.test(
      question
    );

  const containsMemoryIntent =
    keyFact?.intent === "asking" && Boolean(keyFact?.key);

  const shouldMerge = containsMemoryIntent && containsPolicyIntent;

  // 2.a IDENTITY INTRODUCTION via LLM (backup, in case manual regex missed something)
  if (
    keyFact?.intent === "introducing" &&
    keyFact?.value &&
    IDENTITY_KEYS.includes(keyFact.key)
  ) {
    await saveMemory(userId, "user", keyFact.value, keyFact.key, "fact");

    const greeting = `Hello, ${keyFact.value}! How can I assist you today?`;

    await saveMemory(userId, "assistant", greeting, undefined, "chat");

    return {
      answer: greeting,
      history: [
        { role: "user", content: question },
        { role: "assistant", content: greeting },
      ],
      contextUsed: [], // ✅ no rag
      memoryUsed: true,
      meta: {
        rag: {
          topK: 0,
          distanceThreshold: 0,
          chunksReturned: 0,
        },
        memory: {
          similarTopK: config.memory.similarTopK,
          factsCount: 1,
        },
      },
    };
  }

  // 2.b PURE MEMORY RECALL (NO MERGE) – e.g. "Who am I?"
  if (keyFact?.intent === "asking" && keyFact.key && !shouldMerge) {
    const latestFacts = await getLatestFactsByKey(userId);
    const relevantFacts = latestFacts.filter(
      (f) => f.memory_key === keyFact.key
    );

    if (relevantFacts.length) {
      const list = relevantFacts.map((f) => f.content).join(" and ");
      const answer = IDENTITY_KEYS.includes(keyFact.key)
        ? `Your ${keyFact.key} is ${list}.`
        : `Your preferences include ${list}.`;

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
          rag: { topK: 0, distanceThreshold: 0, chunksReturned: 0 },
          memory: {
            similarTopK: config.memory.similarTopK,
            factsCount: latestFacts.length,
          },
        },
      };
    }
  }

  // 2.c SAVE dynamic facts (non-manual path)
  if (
    keyFact &&
    (keyFact.intent === "introducing" || keyFact.intent === "updating") &&
    keyFact.value
  ) {
    await saveMemory(userId, "user", keyFact.value, keyFact.key, "fact");
  }

  const latestFacts = await getLatestFactsByKey(userId);
  const similarTopK = config.memory.similarTopK;

  // Extra safety: identity greeting if key = name and not stored yet
  if (
    keyFact?.intent === "introducing" &&
    keyFact?.value &&
    IDENTITY_KEYS.includes(keyFact.key) &&
    keyFact.key === "name"
  ) {
    const existingIdentity = latestFacts.find(
      (f) => f.memory_key === keyFact.key
    );

    if (!existingIdentity) {
      const greeting = `Hello, ${keyFact.value}! How can I assist you today?`;

      await saveMemory(userId, "assistant", greeting, undefined, "chat");

      return {
        answer: greeting,
        history: [
          { role: "user", content: question },
          { role: "assistant", content: greeting },
        ],
        contextUsed: [],
        memoryUsed: true,
        meta: {
          rag: { topK: 0, distanceThreshold: 0, chunksReturned: 0 },
          memory: {
            similarTopK,
            factsCount: latestFacts.length,
          },
        },
      };
    }
  }

  // Non-identity fact introduction (if we somehow get here without manual path)
  if (
    keyFact?.intent === "introducing" &&
    keyFact.value &&
    !IDENTITY_KEYS.includes(keyFact.key)
  ) {
    const response = `Got it! I'll remember that you ${question.replace(
      /^I\s+/i,
      ""
    )}.`;

    await saveMemory(userId, "user", keyFact.value, keyFact.key, "fact");
    await saveMemory(userId, "assistant", response, undefined, "chat");

    return {
      answer: response,
      history: [
        { role: "user", content: question },
        { role: "assistant", content: response },
      ],
      contextUsed: [], // ✅ No RAG
      memoryUsed: true,
      meta: {
        rag: { topK: 0, distanceThreshold: 0, chunksReturned: 0 },
        memory: {
          similarTopK: config.memory.similarTopK,
          factsCount: 1,
        },
      },
    };
  }

  /**
   * 3) RAG + MEMORY FETCH
   */
  const qEmbedding = await embedText(question);
  const ragResult = await getRagContextForQuery(qEmbedding);
  const ragContext = buildContextFromChunks(ragResult.finalChunks);

  const otherMemoryResults = await retrieveMemory(
    userId,
    qEmbedding,
    similarTopK,
    "user"
  );

  const memoryText = [
    ...latestFacts.map((f) => f.content),
    ...otherMemoryResults,
  ]
    .filter(Boolean)
    .join("\n");

  // Fallback identity recall if nothing hit earlier
  if (keyFact?.intent === "asking") {
    const recallKey = keyFact.key || "name";
    const matched = latestFacts.filter((f) => f.memory_key === recallKey);

    if (matched.length) {
      const combined = matched.map((f) => f.content).join(" and ");
      const answer = IDENTITY_KEYS.includes(recallKey)
        ? `Your ${recallKey} is ${combined}.`
        : `Your preferences include ${combined}.`;

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
          rag: { topK: 0, distanceThreshold: 0, chunksReturned: 0 },
          memory: {
            similarTopK,
            factsCount: latestFacts.length,
          },
        },
      };
    }
  }

  /**
   * 4) ANSWER DECISION
   *    - MERGE MODE (memory + policy)
   *    - RAG + memory
   *    - memory-only
   *    - fallback "I don't know from the document."
   */
  let answer: string;

  // 4.a INTELLIGENT MERGE MODE (for compound Q like "What is my name AND is my coffee habit acceptable based on policy?")
  if (shouldMerge) {
    const memoryKey = keyFact?.key || "name";
    const nameFact = latestFacts.find((f) => f.memory_key === memoryKey);

    const memorySentence = nameFact
      ? `Your ${memoryKey} is ${nameFact.content}.`
      : `I don't have that information stored.`;

    const policyAnswer = ragResult.finalChunks.length
      ? await callLLM(
          `
You are answering ONLY the company policy part of this compound question.

Full user question:
"${question}"

Using ONLY the company policy context below, explain clearly whether the described behavior is acceptable.
If the policy does not explicitly mention it, say that it is not explicitly stated but reason from working hours,
attendance, professionalism, or related clauses. You MUST NOT answer with "I don't know from the document."
`,
          ragContext,
          history,
          memoryText || ""
        )
      : "Company policy does not provide clear guidance on this topic.";

    answer = `${memorySentence} ${policyAnswer}`.trim();
  } else if (ragResult.finalChunks.length > 0) {
    // 4.b RAG + memory (policy questions, etc.)
    answer = await callLLM(
      `
You are an assistant that answers questions based on the company policy and, if helpful, the user's stored preferences.

- Use the provided policy context to answer the question.
- If the policy does not explicitly state something, say so, but still reason from the closest relevant rules.
- You MUST NOT answer with "I don't know from the document." as long as some policy context is provided.
- If the user refers to liking coffee/tea or similar, you may connect that to break rules / professionalism, etc.

Question:
${question}
`,
      ragContext,
      history,
      memoryText || ""
    );
  } else if (memoryText) {
    // 4.c Memory-only question with no relevant docs
    answer = await callLLM(
      `
You are answering based ONLY on the user's stored personal facts and preferences.

Use the memory context below to answer the question if possible.
If it is not possible to answer from memory, say so explicitly.

Question:
${question}
`,
      "",
      history,
      memoryText
    );
  } else {
    // 4.d Safe fallback
    answer = "I don't know from the document.";
  }

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
