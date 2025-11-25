import { Agent } from "@mastra/core/agent";
import { openai } from "@ai-sdk/openai";

export const mastra = new Agent({
  name: "document-agent",
  instructions:
    "You are a helpful assistant. Answer strictly based on context. If the answer is not in the context, say 'I don't know from the document'.",
  model: openai("gpt-4o-mini"),
});

export async function callLLM(
  question: string,
  context: string,
  history: any[] = [],
  memoryText: string = ""
): Promise<string> {
  const messages = [
    {
      role: "system",
      content: `
You are a structured RAG assistant.

RULES:
1. If the question refers to the user's identity or personal facts (name, age, etc), use MEMORY.
2. Otherwise, use DOCUMENT CONTEXT.
3. If not found in either, respond ONLY:
"I don't know from the document."

MEMORY has higher priority for personal questions.
DOCUMENT has priority for knowledge questions.
`,
    },
    { role: "system", content: `MEMORY:\n${memoryText}` },
    { role: "system", content: `DOCUMENT CONTEXT:\n${context}` },
    ...history,
    { role: "user", content: question },
  ];

  const result = await mastra.generate(messages);
  return result.text;
}
