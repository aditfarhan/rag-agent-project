import {
  saveMemory as coreSaveMemory,
  retrieveMemory as coreRetrieveMemory,
} from "../services/memoryService";

/**
 * Backwards-compatible wrappers around the new memory service.
 *
 * Existing imports from "src/service/memory" continue to work, while the
 * implementation is delegated to the centralized memory service under
 * "src/services/memoryService".
 *
 * This file preserves the original function signatures so that all existing
 * call sites remain valid.
 */

/**
 * Save memory for a user.
 * - FACT: unique per memory_key (UPSERT)
 * - CHAT: always appended
 */
export async function saveMemory(
  userId: string,
  role: string,
  content: string,
  memoryKey?: string,
  memoryType: "fact" | "chat" = "chat"
) {
  return coreSaveMemory(userId, role, content, memoryKey, memoryType);
}

/**
 * Retrieve memories with priority:
 * 1. Fact memory (keyed)
 * 2. Most recent chat memory (by similarity)
 */
export async function retrieveMemory(
  userId: string,
  queryEmbedding: number[],
  limit = 5,
  role: "user" | "assistant" | "any" = "user"
) {
  return coreRetrieveMemory(userId, queryEmbedding, limit, role as any);
}
