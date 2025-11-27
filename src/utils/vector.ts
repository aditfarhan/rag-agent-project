/**
 * Utilities for working with pgvector-compatible embeddings.
 *
 * This module centralizes the string literal format used in all SQL queries
 * so that changes to vector representation are done in exactly one place.
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
