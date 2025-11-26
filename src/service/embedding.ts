import { embedText as coreEmbedText } from "../services/embeddingService";

/**
 * Backwards-compatible wrapper around the new embedding service.
 *
 * Existing imports from "src/service/embedding" continue to work, while the
 * implementation is delegated to the centralized embedding service under
 * "src/services/embeddingService".
 */
export async function embedText(text: string): Promise<number[]> {
  return coreEmbedText(text);
}
