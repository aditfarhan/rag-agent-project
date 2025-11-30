export interface InternalChatMeta {
  /**
   * Version of the intent-classification strategy.
   * This is internal-only and never exposed via HTTP responses.
   */
  intentVersion?: string; // e.g. "v1"

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
