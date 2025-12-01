/**
 * Memory management system for conversational AI agent.
 *
 * Provides high-level memory operations for the RAG + Mastra AI architecture:
 * - Saves user facts and chat history with vector embeddings
 * - Retrieves memories using semantic similarity search
 * - Manages conversation-scoped and user-scoped memory contexts
 * - Enables personalized AI responses through persistent memory storage
 *
 * Coordinates with PostgresMemoryRepository for vector-based memory operations,
 * supporting the "memory" component that distinguishes this from generic RAG systems.
 */
import { config } from "@config/index";
import { memoryRepository } from "@infrastructure/database/PostgresMemoryRepository";

export type MemoryType = "fact" | "chat";
export type MemoryRole = "user" | "assistant";
export type MemoryRoleFilter = MemoryRole | "any";

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

export async function saveMemory(
  userId: string,
  role: MemoryRole,
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

export async function retrieveMemory(
  userId: string,
  queryEmbedding: number[],
  limit: number = config.memory.similarTopK,
  role: MemoryRoleFilter = "user",
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

export async function getLatestFactsByKey(
  userId: string,
  conversationId?: number | null
): Promise<UserFact[]> {
  return memoryRepository.getLatestFactsByKey(userId, conversationId);
}

export async function getRecentUserMemories(
  userId: string,
  limit = 5,
  conversationId?: number | null
): Promise<UserMemory[]> {
  return memoryRepository.getRecentUserMemories(userId, limit, conversationId);
}
