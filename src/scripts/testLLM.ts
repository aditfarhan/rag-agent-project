// src/scripts/test_llm.ts
import { callLLM } from "../service/mastraAgent.ts";

async function run() {
  const prompt =
    "CONTEXT:\nThe quick brown fox jumps over the lazy dog.\n\nQUESTION:\nWhat animal jumps over the lazy dog? Provide a short answer.";

  try {
    const res = await callLLM(prompt, "gpt-4o-mini", 256);
    console.log("=== AgentResponse ===");
    console.log("answer:", res.answer);
    console.log("rawPresent:", !!res.raw);
  } catch (err: any) {
    console.error("LLM test error:", err.message ?? err);
    process.exitCode = 2;
  }
}

run();
