/**
 * Memory repository interface definitions.
 *
 * Defines the contract for user memory storage and retrieval:
 * - Persistent storage of user facts, preferences, and chat history
 * - Vector-based similarity search for context-aware memory retrieval
 * - Conversation-scoped memory management
 *
 * Core component enabling personalized AI responses in the RAG system.
 */
import type {
  MemoryRole,
  MemoryRoleFilter,
  MemoryType,
  SavedMemory,
  UserFact,
  UserMemory,
} from "@domain/memory/memoryManager";

export interface MemoryRepository {
  saveMemory(
    userId: string,
    role: MemoryRole,
    content: string,
    memoryKey?: string,
    memoryType?: MemoryType,
    conversationId?: number | null
  ): Promise<SavedMemory>;

  retrieveMemory(
    userId: string,
    queryEmbedding: number[],
    limit?: number,
    role?: MemoryRoleFilter,
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
