/**
 * LLM (Large Language Model) interface definitions.
 *
 * Defines the contract for LLM communication in the RAG + Mastra AI agent system:
 * - Message format for conversation history
 * - Port interface for LLM service implementation
 *
 * Enables flexible LLM integration while maintaining domain-level abstraction.
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
