/**
 * Memory key taxonomy for consistent user identity and preference management.
 *
 * Standardizes the memory retrieval patterns across the RAG + Mastra AI system,
 * enabling reliable fact lookup and personalized response generation.
 *
 * Critical for maintaining conversation continuity and user context retention
 * that distinguishes this RAG implementation from generic document-only systems.
 */
export const IDENTITY_KEYS = [
  "name",
  "full_name",
  "nickname",
  "preferred_name",
] as const;
