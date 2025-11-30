/**
 * OpenAI + Mastra AI agent integration layer.
 *
 * Provides LLM capabilities for the RAG system:
 * - OpenAI API client with retry logic and error handling
 * - Mastra AI agent for context-aware conversations
 * - Embedding generation for vector search
 * - Structured prompting with memory and document context
 *
 * Critical infrastructure enabling the "Generation" component of RAG,
 * powering intelligent responses that combine user memory with document context.
 */
import { openai as mastraOpenAI } from "@ai-sdk/openai";
import { Agent } from "@mastra/core/agent";
import OpenAI from "openai";

import { config } from "@config/index";
import {
  LLMPort,
  LLMHistoryMessage as PortLLMHistoryMessage,
} from "@domain/llm/ports";
import { logEvent, logger } from "@infra/logging/Logger";

export const client = new OpenAI({
  apiKey: config.openai.key,
  baseURL: config.openai.baseUrl,
  timeout: config.openai.timeoutMs,
});

export const mastra = new Agent({
  name: "document-agent",
  instructions: `
You are a personalized RAG assistant.

CONTEXT INPUTS:
- MEMORY: user-specific facts (name, preferences, history, previous answers).
- DOCUMENT CONTEXT: chunks from uploaded Markdown documents.

STRICT RULES:
1. PERSONAL QUESTIONS (identity, name, preferences, "who am I", "what is my name", etc.):
   - Use MEMORY ONLY.
   - If MEMORY contains a name, answer in this format:
     "Hello, {name}! How can I assist you today?"
   - Never claim you don't know if the name is in MEMORY.

2. DOCUMENT QUESTIONS (policy, rules, working hours, procedures, anything about the uploaded docs):
   - Answer ONLY using DOCUMENT CONTEXT.
   - Quote or paraphrase relevant parts from DOCUMENT CONTEXT.
   - Do NOT use external world knowledge.

3. UNKNOWN:
   - If the answer is not present in MEMORY or DOCUMENT CONTEXT,
     respond EXACTLY:
     "I don't know from the document."

4. GENERAL BEHAVIOR:
   - Never hallucinate facts.
   - Never invent user details that are not present in MEMORY.
   - Be concise and clear.
`,
  model: mastraOpenAI(config.openai.model),
});

export type LLMHistoryMessage = PortLLMHistoryMessage;

interface RetryableErrorShape {
  code?: unknown;
  cause?: {
    code?: unknown;
  };
  statusCode?: unknown;
  status?: unknown;
  response?: {
    status?: unknown;
  };
}

interface LlmFailureError extends Error {
  statusCode?: number;
}

interface LlmCatchErrorShape {
  message?: unknown;
  name?: unknown;
  statusCode?: unknown;
}

/**
 * Simple async delay helper used for retry backoff.
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Determines if an error warrants retry in the RAG pipeline.
 *
 * Conservative approach prevents infinite retries while allowing recovery
 * from transient network issues and rate limits that are common in LLM operations.
 */
function isRetryableError(error: unknown): boolean {
  const retryableCodes = new Set(["ECONNRESET", "ETIMEDOUT"]);
  const retryableStatuses = new Set([429, 500, 502, 503]);

  const candidate = error as RetryableErrorShape;

  const code = candidate?.code ?? candidate?.cause?.code;
  if (code && retryableCodes.has(String(code))) {
    return true;
  }

  const status =
    candidate?.statusCode ?? candidate?.status ?? candidate?.response?.status;

  if (typeof status === "number" && retryableStatuses.has(status)) {
    return true;
  }

  return false;
}

/**
 * Retry configuration for LLM operations with exponential backoff.
 *
 * Strategy prioritizes quick recovery from transient failures while preventing
 * resource exhaustion. Conservative retry limits ensure resilience without
 * masking persistent errors in the RAG pipeline.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  operation: string
): Promise<T> {
  const backoffDelays: number[] = [0, 200, 500];

  let lastError: unknown;

  for (let attempt = 1; attempt <= backoffDelays.length; attempt += 1) {
    if (attempt > 1) {
      const delayMs = backoffDelays[attempt - 1] ?? 0;
      await delay(delayMs);
    }

    try {
      return await fn();
    } catch (e: unknown) {
      lastError = e;

      if (!isRetryableError(e) || attempt === backoffDelays.length) {
        throw e;
      }

      const candidate = e as { message?: unknown };

      logger.log("warn", "LLM_RETRY", {
        attempt,
        error:
          typeof candidate.message === "string" ? candidate.message : String(e),
        operation,
      });
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("LLM operation failed after retries.");
}

/**
 * Core LLM call used by higher-level services / use-cases.
 *
 * Responsibilities:
 * - Assemble prompts from MEMORY, DOCUMENT CONTEXT, and conversation history.
 * - Call the Mastra agent backed by an OpenAI-compatible model.
 * - Provide structured logging and error classification.
 *
 * Error handling (preserved from original implementation):
 * - On success, returns the model's text.
 * - On failure, throws an Error with statusCode=502 and logs details.
 */
export async function callLLM(
  question: string,
  context: string,
  history: LLMHistoryMessage[] = [],
  memoryText: string = ""
): Promise<string> {
  const messages: LLMHistoryMessage[] = [
    { role: "system", content: `MEMORY:\n${memoryText || "No memory."}` },
    {
      role: "system",
      content: `DOCUMENT CONTEXT:\n${context || "No documents."}`,
    },
    ...history,
    { role: "user", content: question },
  ];

  const startedAt = Date.now();

  try {
    const result = await withRetry(
      () =>
        mastra.generate(
          messages as unknown as Parameters<(typeof mastra)["generate"]>[0]
        ),
      "llm.generate"
    );
    const durationMs = Date.now() - startedAt;

    const text = result.text;

    logEvent("LLM_SUCCESS", {
      model: config.openai.model,
      durationMs,
      questionLength: question.length,
      contextLength: context.length,
      memoryLength: memoryText.length,
      historyCount: history.length,
    });

    return text;
  } catch (error: unknown) {
    const durationMs = Date.now() - startedAt;

    const caught = error as LlmCatchErrorShape;

    logEvent("LLM_FAILURE", {
      model: config.openai.model,
      durationMs,
      message:
        typeof caught.message === "string" ? caught.message : String(error),
      name: typeof caught.name === "string" ? caught.name : undefined,
    });

    const err: LlmFailureError =
      error instanceof Error
        ? (error as LlmFailureError)
        : new Error("LLM request failed. Check API key or model.");
    err.statusCode =
      typeof caught.statusCode === "number" ? caught.statusCode : 502;
    throw err;
  }
}

export const llmPort: LLMPort = {
  callLLM,
};

/**
 * Validate OpenAI configuration and perform a lightweight connectivity test.
 *
 * This mirrors the original utils/validateOpenAI.ts behavior, but is colocated
 * with the LLM adapter. It MUST NOT throw; it only logs diagnostics.
 */
export async function validateOpenAIKey(): Promise<void> {
  const key = config.openai.key;

  if (!key || key === "mock-key") {
    console.warn(
      "⚠️ OPENAI_API_KEY not provided or using mock-key. LLM features may be disabled or mocked."
    );
    return;
  }

  if (!/^sk-[A-Za-z0-9]{20,}$/.test(key)) {
    console.error(
      "❌ OPENAI_API_KEY format appears invalid. It should start with 'sk-' and contain a valid token."
    );
  } else {
    console.log("✅ OPENAI_API_KEY detected & basic format looks valid.");
  }

  try {
    const healthClient = new OpenAI({
      apiKey: key,
      baseURL: config.openai.baseUrl,
      timeout: Math.min(config.openai.timeoutMs, 5000),
    });

    const startedAt = Date.now();

    const response = await healthClient.embeddings.create({
      model: config.openai.embeddingModel,
      input: "connectivity-check",
    });

    const durationMs = Date.now() - startedAt;
    const hasEmbedding =
      Array.isArray(response.data) && response.data[0]?.embedding?.length;

    if (!hasEmbedding) {
      console.error(
        "❌ OpenAI connectivity test completed but returned no embedding data."
      );
      return;
    }

    console.log(
      `✅ OpenAI connectivity OK via embeddings model="${config.openai.embeddingModel}" in ${durationMs}ms`
    );
  } catch (error: unknown) {
    const caught = error as { message?: unknown; name?: unknown };

    console.error("❌ OpenAI connectivity test failed:", {
      message:
        typeof caught.message === "string" ? caught.message : String(error),
      name: typeof caught.name === "string" ? caught.name : undefined,
    });
  }
}
