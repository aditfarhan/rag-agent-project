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

// ---------- Types & Constants ----------

type HighLevelIntent =
  | "PURE_MEMORY_QUERY"
  | "PURE_POLICY_QUERY"
  | "MERGED_MEMORY_POLICY_QUERY"
  | "UNKNOWN";

const POLICY_REGEX =
  /policy|company|work|acceptable|allowed|forbidden|break|rule|regulation/i;

const PERSONAL_QUESTION_REGEX =
  /^do i (own|have|like|prefer|remember|know)|^am i\b/i;

const MEANINGFUL_TOKENS = new Set<string>([
  "what",
  "why",
  "how",
  "when",
  "where",
  "who",
  "can",
  "should",
  "could",
  "would",
  "is",
  "are",
  "do",
  "does",
  "did",
  "may",
  "might",
  "policy",
  "office",
  "coffee",
  "tea",
  "break",
  "name",
  "own",
  "have",
  "like",
  "prefer",
  "work",
]);

// ---------- LLM Fact Extractor ----------

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

// ---------- Intent Detection ----------

function detectHighLevelIntent(
  question: string,
  keyFact: {
    key: string;
    intent: "introducing" | "asking" | "updating" | "neutral";
  } | null,
  hasPolicyKeyword: boolean,
  isDirectPersonalQuestion: boolean
): HighLevelIntent {
  if (keyFact?.intent === "asking") {
    if (hasPolicyKeyword) {
      return "MERGED_MEMORY_POLICY_QUERY";
    }
    return "PURE_MEMORY_QUERY";
  }

  if (!keyFact && isDirectPersonalQuestion) {
    return "PURE_MEMORY_QUERY";
  }

  if (hasPolicyKeyword) {
    return "PURE_POLICY_QUERY";
  }

  return "UNKNOWN";
}

// ---------- Garbage / nonsense detection ----------

function isGarbageQuestion(text: string): boolean {
  const cleaned = text.trim();
  if (!cleaned) return true;
  if (cleaned.length < 4) return true;

  const alphaMatches = cleaned.match(/[a-zA-Z]/g) || [];
  const hasDigit = /\d/.test(cleaned);
  const punctMatches = cleaned.match(/[?!]/g) || [];
  const manyPunct = punctMatches.length >= 2;

  const tokens = cleaned
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/[^a-z]/g, ""))
    .filter(Boolean);

  const meaningful = tokens.some((t) => MEANINGFUL_TOKENS.has(t));

  if (!meaningful && (hasDigit || manyPunct) && alphaMatches.length < 20) {
    return true;
  }

  return false;
}

// ---------- Helpers ----------

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

async function buildRagAndMemory(
  userId: string,
  question: string,
  latestFacts: any[],
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
    ...latestFacts.map((f: any) => f.content),
    ...otherMemoryResults,
  ]
    .filter(Boolean)
    .join("\n");

  return { ragResult, ragContext, memoryText };
}

// ---------- Pipelines ----------

async function handlePureMemoryQuery(params: {
  userId: string;
  question: string;
  history: any[];
  keyFact: {
    key: string;
    intent: "asking" | "introducing" | "updating" | "neutral";
    value: string;
  } | null;
  latestFacts: any[];
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
      (f: any) => f.memory_key === effectiveKey
    );

    if (relevantFacts.length) {
      const list = relevantFacts.map((f: any) => f.content).join(" and ");
      answer = IDENTITY_KEYS.includes(effectiveKey)
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
  history: any[];
  keyFact: {
    key: string;
    intent: "asking" | "introducing" | "updating" | "neutral";
    value: string;
  } | null;
  latestFacts: any[];
  similarTopK: number;
}): Promise<ChatResponsePayload> {
  const { userId, question, history, keyFact, latestFacts, similarTopK } =
    params;

  const memoryKey =
    keyFact && keyFact.key && keyFact.key !== "unknown" ? keyFact.key : "name";

  const matchedFacts = latestFacts.filter(
    (f: any) => f.memory_key === memoryKey
  );

  const combinedFacts = matchedFacts.map((f: any) => f.content).join(" and ");

  const memorySentence = matchedFacts.length
    ? IDENTITY_KEYS.includes(memoryKey)
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
  history: any[];
  latestFacts: any[];
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
  history: any[];
  latestFacts: any[];
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

// ---------- Main Entry ----------

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

  // 0) Guard for empty question
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

  // 0.b EARLY GIBBERISH / NONSENSE GUARD (no RAG, no memory)
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

  /**
   * 1) HARD-WIRED PATHS (NO LLM, NO RAG)
   */

  // 1.a Manual identity introduction: "My name is Farhan"
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

  // 1.b Manual preference introduction: "I like coffee" / "I now like tea"
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

  // 1.c "What do I like?"
  if (
    normalizedQuestion === "what do i like" ||
    normalizedQuestion === "what do i like?"
  ) {
    const latestFacts = await getLatestFactsByKey(userId);
    const prefs = latestFacts.filter(
      (f: any) => !IDENTITY_KEYS.includes(f.memory_key)
    );

    if (prefs.length) {
      const list = prefs.map((f: any) => f.content).join(" and ");
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

  /**
   * 2) DYNAMIC FACT + INTENT FROM LLM
   */

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
    IDENTITY_KEYS.includes(keyFact.key)
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
    !IDENTITY_KEYS.includes(keyFact.key)
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

  /**
   * 3) LOAD LATEST FACTS & CLASSIFY INTENT
   */

  const latestFacts = await getLatestFactsByKey(userId);
  const similarTopK = config.memory.similarTopK;

  let intent = detectHighLevelIntent(
    trimmedQuestion,
    keyFact,
    hasPolicyKeyword,
    isDirectPersonalQuestion
  );

  // ✅ FORCE POLICY MODE if RAG context exists
  const probeEmbedding = await embedText(trimmedQuestion);
  const probeRag = await getRagContextForQuery(probeEmbedding);

  if (intent === "UNKNOWN" && probeRag.finalChunks.length > 0) {
    intent = "PURE_POLICY_QUERY";
  }

  /**
   * 4) DISPATCH TO PIPELINE
   */

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
