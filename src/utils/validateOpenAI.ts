import { config } from "../config";

export function validateOpenAIKey() {
  if (!config.openaiKey || config.openaiKey === "mock-key") {
    console.warn("⚠️ OPENAI_API_KEY not provided (mock mode)");
    return;
  }

  if (!config.openaiKey.startsWith("sk-")) {
    console.error("❌ OPENAI_API_KEY format is invalid");
  } else {
    console.log("✅ OPENAI_API_KEY detected & format looks valid");
  }
}
