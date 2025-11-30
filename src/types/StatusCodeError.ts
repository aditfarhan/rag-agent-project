/**
 * Extended error interface with HTTP status code support for RAG system.
 *
 * Enables structured error handling with HTTP status codes:
 * - Extends standard Error with optional statusCode property
 * - Used across the application for consistent error propagation
 * - Critical for evaluating error handling quality in RAG + Mastra AI architecture
 *
 * Foundation for the error handling system in the RAG API.
 */
export interface StatusCodeError extends Error {
  statusCode?: number;
}
