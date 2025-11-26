// src/core/mastraAgent.ts
import { Agent } from "@mastra/core/agent";
import { openai } from "@ai-sdk/openai";
import { config } from "../config";
import { logEvent } from "../utils/logger";

/**
 * Core Mastra-powered LLM agent.
 *
 * This module is part of the core domain layer and must not read from .env
 * directly. All configuration is injected via the central config module.
 */

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
  model: openai(config.openai.model),
});

export interface LLMHistoryMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

/**
 * Core LLM call used by higher-level services.
 *
 * Responsibilities:
 * - Assemble prompts from MEMORY, DOCUMENT CONTEXT, and conversation history.
 * - Call the Mastra agent backed by an OpenAI-compatible model.
 * - Provide structured logging and error classification.
 *
 * Error handling:
 * - On success, returns the model's text.
 * - On failure, throws an Error with statusCode=502 and logs details.
 *   Callers can choose to gracefully degrade (e.g., return a fallback answer).
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
    // Mastra's generate() expects a MessageListInput type that is structurally
    // compatible with our message shape, but typed more loosely. We cast at the
    // boundary to satisfy TypeScript while keeping strong typing internally.
    const result = await mastra.generate(messages as any);
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
  } catch (error: any) {
    const durationMs = Date.now() - startedAt;

    logEvent("LLM_FAILURE", {
      model: config.openai.model,
      durationMs,
      message: error?.message || String(error),
      name: error?.name,
    });

    const err =
      error instanceof Error
        ? error
        : new Error("LLM request failed. Check API key or model.");
    (err as any).statusCode = (error as any)?.statusCode || 502;
    throw err;
  }
}
