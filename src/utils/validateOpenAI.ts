import { config } from "../config";

export function validateOpenAIKey() {
  if (!config.openai.key || config.openai.key === "mock-key") {
    console.warn("⚠️ OPENAI_API_KEY not provided (mock mode)");
    return;
  }

  if (!config.openai.key.startsWith("sk-")) {
    console.error("❌ OPENAI_API_KEY format is invalid");
  } else {
    console.log("✅ OPENAI_API_KEY detected & format looks valid");
  }
}
