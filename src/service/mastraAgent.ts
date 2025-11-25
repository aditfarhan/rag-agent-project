// src/service/mastraAgent.ts
import { Agent } from "@mastra/core/agent";
import { openai } from "@ai-sdk/openai";
import { config } from "../config";

export const mastra = new Agent({
  name: "document-agent",
  instructions: `
You are a personalized RAG assistant.

CONTEXT INPUTS:
- MEMORY: user-specific facts (name, preferences, history, previous answers).
- DOCUMENT CONTEXT: chunks from uploaded Markdown documents.

STRICT RULES:
1. PERSONAL QUESTIONS (identity, name, preferences, "who am I", "what is my name", etc.):
   - Use MEMORY ONLY.
   - If MEMORY contains a name, answer in this format:
     "Hello, {name}! How can I assist you today?"
   - Never claim you don't know if the name is in MEMORY.

2. DOCUMENT QUESTIONS (policy, rules, working hours, procedures, anything about the uploaded docs):
   - Answer ONLY using DOCUMENT CONTEXT.
   - Quote or paraphrase relevant parts from DOCUMENT CONTEXT.
   - Do NOT use external world knowledge.

3. UNKNOWN:
   - If the answer is not present in MEMORY or DOCUMENT CONTEXT,
     respond EXACTLY:
     "I don't know from the document."

4. GENERAL BEHAVIOR:
   - Never hallucinate facts.
   - Never invent user details that are not present in MEMORY.
   - Be concise and clear.
`,
  model: openai(config.model),
});

export async function callLLM(
  question: string,
  context: string,
  history: any[] = [],
  memoryText: string = ""
): Promise<string> {
  const messages = [
    { role: "system", content: `MEMORY:\n${memoryText || "No memory."}` },
    {
      role: "system",
      content: `DOCUMENT CONTEXT:\n${context || "No documents."}`,
    },
    ...history,
    { role: "user", content: question },
  ];

  const result = await mastra.generate(messages);
  return result.text;
}
