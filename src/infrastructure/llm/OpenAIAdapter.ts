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
import { config } from "@config/index";
import {
  LLMPort,
  LLMHistoryMessage as PortLLMHistoryMessage,
} from "@domain/llm/ports";
import { logEvent, logger } from "@infrastructure/logging/Logger";
import { Agent } from "@mastra/core/agent";
import OpenAI from "openai";

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

interface LlmFailureError extends Error {
  statusCode?: number;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableError(error: unknown): boolean {
  const retryableCodes = new Set(["ECONNRESET", "ETIMEDOUT"]);
  const retryableStatuses = new Set([429, 500, 502, 503]);

  const candidate =
    error instanceof Error
      ? {
          code: (error as { code?: unknown }).code as string | undefined,
          cause: (error as { cause?: unknown }).cause as
            | { code?: string }
            | undefined,
          statusCode: (error as { statusCode?: unknown }).statusCode as
            | number
            | undefined,
          status: (error as { status?: unknown }).status as number | undefined,
          response: (error as { response?: unknown }).response as
            | { status?: number }
            | undefined,
        }
      : {};

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

      const candidate =
        e instanceof Error ? { message: e.message } : { message: String(e) };

      logger.log("warn", "LLM_RETRY", {
        attempt,
        error: candidate.message ?? String(e),
        operation,
      });
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("LLM operation failed after retries.");
}

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
        mastra.generate(messages as Parameters<(typeof mastra)["generate"]>[0]),
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

    const caught =
      error instanceof Error
        ? {
            message: error.message,
            name: error.name,
            statusCode: (error as LlmFailureError).statusCode,
          }
        : { message: String(error), name: undefined, statusCode: undefined };

    logEvent("LLM_FAILURE", {
      model: config.openai.model,
      durationMs,
      message: caught.message ?? String(error),
      name: caught.name,
    });

    const err: LlmFailureError =
      error instanceof Error && "statusCode" in error
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
    const caught =
      error instanceof Error
        ? { message: error.message, name: error.name }
        : { message: String(error), name: undefined };

    console.error("❌ OpenAI connectivity test failed:", {
      message: caught.message ?? String(error),
      name: caught.name,
    });
  }
}
