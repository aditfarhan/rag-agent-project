/**
 * Internal chat metadata for conversational AI system in RAG + Mastra AI architecture.
 *
 * Defines metadata tracking for intent classification and LLM confidence:
 * - Version tracking for intent classification strategies
 * - Confidence scores from both classification and LLM layers
 * - Internal-only metrics not exposed via public API
 *
 * Supports system observability and debugging without client exposure.
 * Critical for evaluating clean code practices and error handling quality.
 */
export interface InternalChatMeta {
  intentVersion?: string;

  /**
   * Confidence assigned by the intent classifier (0..1).
   * This is a best-effort internal signal and not part of the public API.
   */
  intentConfidence?: number;

  /**
   * Optional confidence from the LLM layer, when available.
   * This is internal-only and not serialized to clients.
   */
  llmConfidence?: number | null;
}
