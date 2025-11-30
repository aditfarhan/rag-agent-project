/**
 * Domain port for LLM interactions.
 *
 * This interface captures the minimal contract the domain/app layers rely on:
 * a single text-generating call that combines:
 * - user question
 * - RAG context
 * - conversation history
 * - memory text
 *
 * IMPORTANT:
 * - The concrete implementation in infrastructure/llm/OpenAIAdapter.ts
 *   preserves all existing behavior, prompts, and logging.
 * - This port is intentionally aligned with the existing callLLM signature
 *   so that introducing it does not change any call sites or runtime output.
 */
export interface LLMHistoryMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface LLMPort {
  callLLM(
    question: string,
    context: string,
    history?: LLMHistoryMessage[],
    memoryText?: string
  ): Promise<string>;
}
