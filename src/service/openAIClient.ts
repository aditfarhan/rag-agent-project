import OpenAI from "openai";
import { config } from "../config";

/**
 * Shared OpenAI client.
 *
 * All direct calls to the OpenAI-compatible API (embeddings, chat, etc.)
 * should go through this client or higher-level services built on top of it.
 *
 * The client is fully configured via the central config module:
 * - API key
 * - Base URL (for compatible providers / gateways)
 * - Request timeout
 */
export const client = new OpenAI({
  apiKey: config.openai.key,
  // Optional compatible base URL, e.g. for proxies or gateways.
  // When undefined, the official api.openai.com endpoint is used.
  baseURL: config.openai.baseUrl,
  timeout: config.openai.timeoutMs,
});

export type OpenAIClient = typeof client;
