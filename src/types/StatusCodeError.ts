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
export interface StatusCodeErrorInterface extends Error {
  statusCode?: number;
}

export const StatusCodeError = class
  extends Error
  implements StatusCodeErrorInterface
{
  statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = "StatusCodeError";
    if (statusCode !== undefined) {
      this.statusCode = statusCode;
    }
  }
};
