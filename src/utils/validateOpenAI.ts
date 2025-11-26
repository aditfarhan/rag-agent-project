import OpenAI from "openai";
import { config } from "../config";

/**
 * Validate OpenAI configuration and perform a lightweight connectivity test.
 *
 * Responsibilities:
 * - Key presence & mock-mode detection
 * - Key format validation
 * - Online connectivity check against the embeddings endpoint
 * - Clear logging for success/failure
 * - Safe fallback behavior (never throws)
 *
 * NOTE:
 * - This function MUST NOT throw. It is intended for diagnostics at startup.
 * - Core request paths should perform their own error handling when calling the LLM.
 */
export async function validateOpenAIKey(): Promise<void> {
  const key = config.openai.key;

  if (!key || key === "mock-key") {
    console.warn(
      "⚠️ OPENAI_API_KEY not provided or using mock-key. LLM features may be disabled or mocked."
    );
    return;
  }

  // 1) Basic key format validation (do not throw, only log)
  if (!/^sk-[A-Za-z0-9]{20,}$/.test(key)) {
    console.error(
      "❌ OPENAI_API_KEY format appears invalid. It should start with 'sk-' and contain a valid token."
    );
  } else {
    console.log("✅ OPENAI_API_KEY detected & basic format looks valid.");
  }

  // 2) Online connectivity test (non-fatal)
  try {
    const client = new OpenAI({
      apiKey: key,
      baseURL: config.openai.baseUrl,
      // Use a conservative timeout for health checks to avoid blocking startup.
      timeout: Math.min(config.openai.timeoutMs, 5000),
    });

    const startedAt = Date.now();

    const response = await client.embeddings.create({
      model: config.openai.embeddingModel,
      input: "connectivity-check",
    });

    const durationMs = Date.now() - startedAt;
    const hasEmbedding =
      Array.isArray(response.data) && response.data[0]?.embedding?.length;

    if (!hasEmbedding) {
      console.error(
        "❌ OpenAI connectivity test completed but returned no embedding data."
      );
      return;
    }

    console.log(
      `✅ OpenAI connectivity OK via embeddings model="${config.openai.embeddingModel}" in ${durationMs}ms`
    );
  } catch (error: any) {
    // Do NOT throw — only log. Application should still start.
    console.error("❌ OpenAI connectivity test failed:", {
      message: error?.message || String(error),
      name: error?.name,
    });
  }
}
