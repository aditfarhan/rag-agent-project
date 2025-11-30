/**
 * Vector utilities for PostgreSQL pgvector integration in RAG system.
 *
 * Provides consistent embedding format conversion for semantic search operations.
 * Ensures all vector operations use uniform representation for reliable
 * similarity calculations in both document retrieval and memory search contexts.
 *
 * Critical infrastructure for the "retrieval" phase of RAG and memory subsystems.
 */
export function toPgVectorLiteral(vector: number[]): string {
  if (!Array.isArray(vector)) {
    throw new TypeError("toPgVectorLiteral expected an array");
  }

  if (vector.length === 0) {
    throw new Error("toPgVectorLiteral received an empty vector");
  }

  if (!vector.every((v) => Number.isFinite(v))) {
    throw new Error("toPgVectorLiteral received a non-finite value");
  }

  return `[${vector.join(",")}]`;
}
