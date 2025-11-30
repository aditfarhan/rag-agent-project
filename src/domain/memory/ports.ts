import type {
  MemoryRole,
  MemoryType,
  SavedMemory,
  UserFact,
  UserMemory,
} from "./memoryManager";

/**
 * Domain port for user memory persistence and retrieval.
 *
 * This interface describes the contract used by higher layers. The current
 * implementation lives in memoryManager and talks directly to Postgres;
 * future infrastructure adapters (e.g., PostgresMemoryRepository) will
 * implement this interface without changing behavior.
 */
export interface MemoryRepository {
  saveMemory(
    userId: string,
    role: string,
    content: string,
    memoryKey?: string,
    memoryType?: MemoryType,
    conversationId?: number | null
  ): Promise<SavedMemory>;

  retrieveMemory(
    userId: string,
    queryEmbedding: number[],
    limit?: number,
    role?: MemoryRole | "any",
    conversationId?: number | null
  ): Promise<string[]>;

  getLatestFactsByKey(
    userId: string,
    conversationId?: number | null
  ): Promise<UserFact[]>;

  getRecentUserMemories(
    userId: string,
    limit?: number,
    conversationId?: number | null
  ): Promise<UserMemory[]>;
}
