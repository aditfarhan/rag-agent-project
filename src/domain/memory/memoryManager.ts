import { config } from "@config/index";
import { memoryRepository } from "@infra/database/PostgresMemoryRepository";

export type MemoryType = "fact" | "chat";
export type MemoryRole = "user" | "assistant";

export interface SavedMemory {
  id: number;
  content: string;
  memory_key: string | null;
}

export interface UserFact {
  memory_key: string;
  content: string;
}

export interface UserMemory {
  memory_key: string | null;
  content: string;
}

/**
 * Save a memory entry for a user.
 *
 * Behavior is preserved by delegating to the PostgresMemoryRepository, which
 * implements the original logic:
 * - FACT: unique per memory_key (UPSERT semantics).
 * - CHAT: always appended.
 */
export async function saveMemory(
  userId: string,
  role: string,
  content: string,
  memoryKey?: string,
  memoryType: MemoryType = "chat",
  conversationId?: number | null
): Promise<SavedMemory> {
  return memoryRepository.saveMemory(
    userId,
    role,
    content,
    memoryKey,
    memoryType,
    conversationId
  );
}

/**
 * INTELLIGENT MEMORY RETRIEVAL
 *
 * Behavior is preserved by delegating to the PostgresMemoryRepository, which
 * keeps the original scoring and logging:
 * - Fetch more candidates from DB
 * - Score each memory:
 *   score = similarity*0.6 + recency*0.3 + typeBoost
 * - Return top `limit` most valuable memories
 */
export async function retrieveMemory(
  userId: string,
  queryEmbedding: number[],
  limit: number = config.memory.similarTopK,
  role: MemoryRole | "any" = "user",
  conversationId?: number | null
): Promise<string[]> {
  return memoryRepository.retrieveMemory(
    userId,
    queryEmbedding,
    limit,
    role,
    conversationId
  );
}

/**
 * Retrieve the latest FACT memories per key for a user.
 * Delegates to the PostgresMemoryRepository, preserving behavior.
 */
export async function getLatestFactsByKey(
  userId: string,
  conversationId?: number | null
): Promise<UserFact[]> {
  return memoryRepository.getLatestFactsByKey(userId, conversationId);
}

/**
 * Retrieve recent user memories ordered by latest update.
 * Delegates to the PostgresMemoryRepository, preserving behavior.
 */
export async function getRecentUserMemories(
  userId: string,
  limit = 5,
  conversationId?: number | null
): Promise<UserMemory[]> {
  return memoryRepository.getRecentUserMemories(userId, limit, conversationId);
}
