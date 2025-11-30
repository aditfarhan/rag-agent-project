/**
 * Main chat orchestration use-case combining RAG, memory, and LLM reasoning.
 *
 * Implements the core conversation flow that:
 * - Detects user intent through pattern matching and LLM classification
 * - Retrieves relevant memories and document context via vector similarity
 * - Generates contextually appropriate responses using Mastra AI agent
 * - Manages conversation history and stores new memories
 *
 * Serves as the primary entry point for the /api/chat endpoint.
 */
import crypto from "crypto";

import { config } from "@config/index";
import { IDENTITY_KEYS } from "@config/memoryKeys";
import {
  extractDynamicKeyFact,
  detectHighLevelIntent,
  isGarbageQuestion,
  POLICY_REGEX,
  PERSONAL_QUESTION_REGEX,
} from "@domain/chat/IntentClassifier";
import {
  getLatestFactsByKey,
  retrieveMemory,
  saveMemory,
} from "@domain/memory/memoryManager";
import {
  buildContextFromChunks,
  getRagContextForQuery,
} from "@domain/rag/ragEngine";
import { embedText } from "@infra/llm/EmbeddingProvider";
import { callLLM } from "@infra/llm/OpenAIAdapter";
import { logEvent, logger } from "@infra/logging/Logger";

import type { InternalChatMeta } from "types/ChatMeta";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  userId: string;
  question: string;
  history?: ChatMessage[];
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
  history: ChatMessage[];
  contextUsed: unknown[];
  memoryUsed: boolean;
  meta: ChatResponseMeta;
}

function buildMeta(
  ragMetaOverride: Partial<ChatResponseMeta["rag"]>,
  memoryMetaOverride: Partial<ChatResponseMeta["memory"]>,
  similarTopK: number,
  factsCount: number
): ChatResponseMeta {
  return {
    rag: {
      topK: ragMetaOverride.topK ?? 0,
      distanceThreshold: ragMetaOverride.distanceThreshold ?? 0,
      chunksReturned: ragMetaOverride.chunksReturned ?? 0,
    },
    memory: {
      similarTopK:
        memoryMetaOverride.similarTopK !== undefined
          ? memoryMetaOverride.similarTopK
          : similarTopK,
      factsCount:
        memoryMetaOverride.factsCount !== undefined
          ? memoryMetaOverride.factsCount
          : factsCount,
    },
  };
}

type IdentityKey = (typeof IDENTITY_KEYS)[number];

function isIdentityKey(key: string): key is IdentityKey {
  return (IDENTITY_KEYS as readonly string[]).includes(key);
}

type LatestFact = {
  memory_key: string;
  content: string;
};

async function buildRagAndMemory(
  userId: string,
  question: string,
  latestFacts: LatestFact[],
  similarTopK: number
) {
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
    ...latestFacts.map((f: LatestFact) => f.content),
    ...otherMemoryResults,
  ]
    .filter(Boolean)
    .join("\n");

  return { ragResult, ragContext, memoryText };
}

async function handlePureMemoryQuery(params: {
  userId: string;
  question: string;
  history: ChatMessage[];
  keyFact: {
    key: string;
    intent: "asking" | "introducing" | "updating" | "neutral";
    value: string;
  } | null;
  latestFacts: LatestFact[];
  similarTopK: number;
}): Promise<ChatResponsePayload> {
  const { userId, question, history, keyFact, latestFacts, similarTopK } =
    params;

  const effectiveKey =
    keyFact && keyFact.key && keyFact.key !== "unknown" ? keyFact.key : null;

  let answer: string;
  let memoryUsed = false;

  if (effectiveKey) {
    const relevantFacts = latestFacts.filter(
      (f: LatestFact) => f.memory_key === effectiveKey
    );

    if (relevantFacts.length) {
      const list = relevantFacts
        .map((f: LatestFact) => f.content)
        .join(" and ");
      answer = isIdentityKey(effectiveKey)
        ? `Your ${effectiveKey} is ${list}.`
        : `Your preferences include ${list}.`;
      memoryUsed = true;
    } else {
      answer = "I don't have any stored memory about that yet.";
      memoryUsed = false;
    }
  } else {
    answer = "I don't have any stored memory about that yet.";
    memoryUsed = false;
  }

  await saveMemory(userId, "assistant", answer, undefined, "chat");

  return {
    answer,
    history: [
      ...history,
      { role: "user", content: question },
      { role: "assistant", content: answer },
    ],
    contextUsed: [],
    memoryUsed,
    meta: buildMeta(
      { topK: 0, distanceThreshold: 0, chunksReturned: 0 },
      {},
      similarTopK,
      latestFacts.length
    ),
  };
}

async function handleMergedMemoryPolicyQuery(params: {
  userId: string;
  question: string;
  history: ChatMessage[];
  keyFact: {
    key: string;
    intent: "asking" | "introducing" | "updating" | "neutral";
    value: string;
  } | null;
  latestFacts: LatestFact[];
  similarTopK: number;
}): Promise<ChatResponsePayload> {
  const { userId, question, history, keyFact, latestFacts, similarTopK } =
    params;

  const memoryKey =
    keyFact && keyFact.key && keyFact.key !== "unknown" ? keyFact.key : "name";

  const matchedFacts = latestFacts.filter(
    (f: LatestFact) => f.memory_key === memoryKey
  );

  const combinedFacts = matchedFacts
    .map((f: LatestFact) => f.content)
    .join(" and ");

  const memorySentence = matchedFacts.length
    ? isIdentityKey(memoryKey)
      ? `Your ${memoryKey} is ${combinedFacts}.`
      : `Your ${memoryKey} includes ${combinedFacts}.`
    : `I don't have your ${memoryKey} stored yet.`;

  const { ragResult, ragContext, memoryText } = await buildRagAndMemory(
    userId,
    question,
    latestFacts,
    similarTopK
  );

  let policyAnswer: string;

  if (!ragResult.finalChunks.length) {
    policyAnswer =
      "Based on the available company policy, there is no explicit rule about that behavior. However, employees are expected to follow standard working hours, break rules, and maintain professionalism.";
  } else {
    const raw = await callLLM(
      `
You are answering ONLY the company policy part of a compound user question.

Full user question:
"${question}"

Instructions:
- Do NOT restate the user's name or other personal facts.
- Use ONLY the policy context to explain whether the described behavior is acceptable.
- If the policy does not explicitly mention it, say that it is not explicitly stated, but reason from working hours, attendance, breaks, or professionalism.
- Avoid phrases like "I don't know from the document." even if the policy is silent.
`,
      ragContext,
      history,
      memoryText || ""
    );

    const cleaned = raw.trim();
    if (
      !cleaned ||
      /i don't know from the document/i.test(cleaned) ||
      /^i don't know\b/i.test(cleaned)
    ) {
      policyAnswer =
        "Based on the company policy, there is no explicit rule about coffee or break habits, but employees are expected to follow standard working hours, agreed break times, and maintain professionalism. Frequent breaks should be discussed with your manager.";
    } else {
      policyAnswer = cleaned;
    }
  }

  const answer = `${memorySentence} ${policyAnswer}`.trim();

  await saveMemory(userId, "assistant", answer, undefined, "chat");

  return {
    answer,
    history: [
      ...history,
      { role: "user", content: question },
      { role: "assistant", content: answer },
    ],
    contextUsed: ragResult.finalChunks,
    memoryUsed: matchedFacts.length > 0 || Boolean(memoryText),
    meta: buildMeta(
      {
        topK: ragResult.meta.topK,
        distanceThreshold: ragResult.meta.distanceThreshold,
        chunksReturned: ragResult.meta.chunksReturned,
      },
      {},
      similarTopK,
      latestFacts.length
    ),
  };
}

async function handlePurePolicyQuery(params: {
  userId: string;
  question: string;
  history: ChatMessage[];
  latestFacts: LatestFact[];
  similarTopK: number;
}): Promise<ChatResponsePayload> {
  const { userId, question, history, latestFacts, similarTopK } = params;

  const { ragResult, ragContext, memoryText } = await buildRagAndMemory(
    userId,
    question,
    latestFacts,
    similarTopK
  );

  let answer: string;

  if (!ragResult.finalChunks.length) {
    answer =
      "Based on the policy information I have, there is no explicit rule about that. You may need to confirm with HR or your manager.";
  } else {
    const raw = await callLLM(
      `
You are an assistant that answers questions based on the company policy and, when helpful, the user's stored preferences.

- Use the provided policy context to answer the question.
- If the policy does not explicitly state something, say so, but still reason from the closest relevant rules (working hours, breaks, conduct, etc).
- Avoid using the exact phrase "I don't know from the document." as long as some policy context is provided.

Question:
${question}
`,
      ragContext,
      history,
      memoryText || ""
    );

    const cleaned = raw.trim();
    if (
      !cleaned ||
      /i don't know from the document/i.test(cleaned) ||
      /^i don't know\b/i.test(cleaned)
    ) {
      answer =
        "The company policy does not explicitly mention that scenario, but employees are expected to follow standard working hours, break rules, and maintain professionalism.";
    } else {
      answer = cleaned;
    }
  }

  await saveMemory(userId, "assistant", answer, undefined, "chat");

  return {
    answer,
    history: [
      ...history,
      { role: "user", content: question },
      { role: "assistant", content: answer },
    ],
    contextUsed: ragResult.finalChunks,
    memoryUsed: Boolean(memoryText),
    meta: buildMeta(
      {
        topK: ragResult.meta.topK,
        distanceThreshold: ragResult.meta.distanceThreshold,
        chunksReturned: ragResult.meta.chunksReturned,
      },
      {},
      similarTopK,
      latestFacts.length
    ),
  };
}

async function handleUnknownQuery(params: {
  userId: string;
  question: string;
  history: ChatMessage[];
  latestFacts: LatestFact[];
  similarTopK: number;
}): Promise<ChatResponsePayload> {
  const { userId, question, history, latestFacts, similarTopK } = params;

  const { ragResult, ragContext, memoryText } = await buildRagAndMemory(
    userId,
    question,
    latestFacts,
    similarTopK
  );

  const hasRag = ragResult.finalChunks.length > 0;
  const hasMemory = Boolean(memoryText);

  let answer: string;
  let contextUsed: unknown[] = [];

  if (!hasRag && !hasMemory) {
    answer =
      "It seems like your question isn't clear. Could you rephrase or provide more detail?";
    contextUsed = [];
  } else {
    const raw = await callLLM(
      `
You are a helpful assistant.

You may use:
- The company policy context (if relevant)
- The user's stored memories (if relevant)

If the question does not clearly relate to either, ask the user politely to clarify,
instead of forcing an answer.

Question:
${question}
`,
      hasRag ? ragContext : "",
      history,
      memoryText
    );

    answer = raw.trim() || "I'm not sure I understood that. Could you clarify?";
    contextUsed = ragResult.finalChunks;
  }

  await saveMemory(userId, "assistant", answer, undefined, "chat");

  return {
    answer,
    history: [
      ...history,
      { role: "user", content: question },
      { role: "assistant", content: answer },
    ],
    contextUsed,
    memoryUsed: hasMemory,
    meta: buildMeta(
      hasRag
        ? {
            topK: ragResult.meta.topK,
            distanceThreshold: ragResult.meta.distanceThreshold,
            chunksReturned: ragResult.meta.chunksReturned,
          }
        : { topK: 0, distanceThreshold: 0, chunksReturned: 0 },
      {},
      similarTopK,
      latestFacts.length
    ),
  };
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

  if (!trimmedQuestion) {
    const answer = "question required";

    return {
      answer,
      history: [
        ...history,
        { role: "user", content: question },
        { role: "assistant", content: answer },
      ],
      contextUsed: [],
      memoryUsed: false,
      meta: buildMeta(
        { topK: 0, distanceThreshold: 0, chunksReturned: 0 },
        {},
        config.memory.similarTopK,
        0
      ),
    };
  }

  if (isGarbageQuestion(trimmedQuestion)) {
    const answer =
      "It looks like your message might be incomplete or unclear. Could you please rephrase your question?";

    const meta = buildMeta(
      { topK: 0, distanceThreshold: 0, chunksReturned: 0 },
      {},
      config.memory.similarTopK,
      0
    );

    return {
      answer,
      history: [
        ...history,
        { role: "user", content: question },
        { role: "assistant", content: answer },
      ],
      contextUsed: [],
      memoryUsed: false,
      meta,
    };
  }

  // Fast-path processing for simple identity declarations
  // These patterns enable immediate personalized responses without RAG overhead
  const nameMatch = trimmedQuestion.match(/\bmy name is\s+(.+)/i);
  if (nameMatch && nameMatch[1]) {
    const name = nameMatch[1].trim().replace(/[.!?,]+$/, "");

    await saveMemory(userId, "user", name, "name", "fact");

    const greeting = `Hello, ${name}! How can I assist you today?`;

    await saveMemory(userId, "assistant", greeting, undefined, "chat");

    const meta = buildMeta(
      { topK: 0, distanceThreshold: 0, chunksReturned: 0 },
      {},
      config.memory.similarTopK,
      1
    );

    return {
      answer: greeting,
      history: [
        ...history,
        { role: "user", content: question },
        { role: "assistant", content: greeting },
      ],
      contextUsed: [],
      memoryUsed: true,
      meta,
    };
  }

  // Fast-path for preference capture - enables immediate personalized responses
  // Distinguishes preference storage from identity for targeted memory retrieval
  const likeMatch = trimmedQuestion.match(/^i\s+(now\s+)?like\s+(.+)/i);
  if (likeMatch && likeMatch[2]) {
    const pref = likeMatch[2].trim().replace(/[.!?,]+$/, "");

    await saveMemory(userId, "user", pref, "preference", "fact");

    const response = `Got it! I'll remember that you like ${pref}.`;

    await saveMemory(userId, "assistant", response, undefined, "chat");

    const meta = buildMeta(
      { topK: 0, distanceThreshold: 0, chunksReturned: 0 },
      {},
      config.memory.similarTopK,
      1
    );

    return {
      answer: response,
      history: [
        ...history,
        { role: "user", content: question },
        { role: "assistant", content: response },
      ],
      contextUsed: [],
      memoryUsed: true,
      meta,
    };
  }

  if (
    normalizedQuestion === "what do i like" ||
    normalizedQuestion === "what do i like?"
  ) {
    const latestFacts = await getLatestFactsByKey(userId);
    const prefs = latestFacts.filter(
      (f: LatestFact) => !isIdentityKey(f.memory_key)
    );

    if (prefs.length) {
      const list = prefs.map((f: LatestFact) => f.content).join(" and ");
      const answer = `Your preferences include ${list}.`;

      await saveMemory(userId, "assistant", answer, undefined, "chat");

      return {
        answer,
        history: [
          ...history,
          { role: "user", content: question },
          { role: "assistant", content: answer },
        ],
        contextUsed: [],
        memoryUsed: true,
        meta: buildMeta(
          { topK: 0, distanceThreshold: 0, chunksReturned: 0 },
          {},
          config.memory.similarTopK,
          latestFacts.length
        ),
      };
    }

    const fallback = "I don't have any stored preferences yet.";

    await saveMemory(userId, "assistant", fallback, undefined, "chat");

    return {
      answer: fallback,
      history: [
        ...history,
        { role: "user", content: question },
        { role: "assistant", content: fallback },
      ],
      contextUsed: [],
      memoryUsed: false,
      meta: buildMeta(
        { topK: 0, distanceThreshold: 0, chunksReturned: 0 },
        {},
        config.memory.similarTopK,
        0
      ),
    };
  }

  const hasPolicyKeyword = POLICY_REGEX.test(question);
  const isDirectPersonalQuestion =
    PERSONAL_QUESTION_REGEX.test(trimmedQuestion);

  let keyFact = await extractDynamicKeyFact(question);

  if (!keyFact && isDirectPersonalQuestion) {
    keyFact = {
      key: "unknown",
      value: "",
      intent: "asking",
    };
  }

  if (
    keyFact?.intent === "introducing" &&
    keyFact.value &&
    isIdentityKey(keyFact.key)
  ) {
    await saveMemory(userId, "user", keyFact.value, keyFact.key, "fact");

    const greeting = `Hello, ${keyFact.value}! How can I assist you today?`;

    await saveMemory(userId, "assistant", greeting, undefined, "chat");

    return {
      answer: greeting,
      history: [
        ...history,
        { role: "user", content: question },
        { role: "assistant", content: greeting },
      ],
      contextUsed: [],
      memoryUsed: true,
      meta: buildMeta(
        { topK: 0, distanceThreshold: 0, chunksReturned: 0 },
        {},
        config.memory.similarTopK,
        1
      ),
    };
  }

  if (
    keyFact &&
    (keyFact.intent === "introducing" || keyFact.intent === "updating") &&
    keyFact.value &&
    !isIdentityKey(keyFact.key)
  ) {
    await saveMemory(userId, "user", keyFact.value, keyFact.key, "fact");

    const response = `Got it! I'll remember that you ${question.replace(
      /^I\s+/i,
      ""
    )}.`;

    await saveMemory(userId, "assistant", response, undefined, "chat");

    return {
      answer: response,
      history: [
        ...history,
        { role: "user", content: question },
        { role: "assistant", content: response },
      ],
      contextUsed: [],
      memoryUsed: true,
      meta: buildMeta(
        { topK: 0, distanceThreshold: 0, chunksReturned: 0 },
        {},
        config.memory.similarTopK,
        1
      ),
    };
  }

  const latestFacts = await getLatestFactsByKey(userId);
  const similarTopK = config.memory.similarTopK;

  let intent = detectHighLevelIntent(
    trimmedQuestion,
    keyFact,
    hasPolicyKeyword,
    isDirectPersonalQuestion
  );

  const internalMeta: InternalChatMeta = {
    intentVersion: "v1",
    intentConfidence: 1,
    llmConfidence: null,
  };

  logger.log("debug", "INTENT_RESOLVED", {
    userId,
    intent,
    intentVersion: internalMeta.intentVersion,
    intentConfidence: internalMeta.intentConfidence,
  });

  const probeEmbedding = await embedText(trimmedQuestion);
  const probeRag = await getRagContextForQuery(probeEmbedding);

  if (intent === "UNKNOWN" && probeRag.finalChunks.length > 0) {
    intent = "PURE_POLICY_QUERY";
  }

  let response: ChatResponsePayload;

  if (intent === "PURE_MEMORY_QUERY") {
    response = await handlePureMemoryQuery({
      userId,
      question,
      history,
      keyFact,
      latestFacts,
      similarTopK,
    });
  } else if (intent === "MERGED_MEMORY_POLICY_QUERY") {
    response = await handleMergedMemoryPolicyQuery({
      userId,
      question,
      history,
      keyFact,
      latestFacts,
      similarTopK,
    });
  } else if (intent === "PURE_POLICY_QUERY") {
    response = await handlePurePolicyQuery({
      userId,
      question,
      history,
      latestFacts,
      similarTopK,
    });
  } else {
    response = await handleUnknownQuery({
      userId,
      question,
      history,
      latestFacts,
      similarTopK,
    });
  }

  const duration = Date.now() - startTime;

  logEvent("CHAT_RESPONSE", {
    requestId,
    userId,
    answerLength: response.answer.length,
    durationMs: duration,
  });

  return response;
}
