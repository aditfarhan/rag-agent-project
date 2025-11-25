import { Agent } from "@mastra/core/agent";
import { openai } from "@ai-sdk/openai";

export const mastra = new Agent({
  name: "document-agent",
  instructions: `
You are a personalized RAG assistant.

STRICT RULES:
1. If the question relates to personal facts (identity, name, preferences, history), ALWAYS use MEMORY.
2. If the question relates to general knowledge or uploaded files, ONLY use DOCUMENT CONTEXT.
3. If neither MEMORY nor DOCUMENT contain the answer, respond exactly:
"I don't know from the document."

IMPORTANT:
- MEMORY has highest priority for personal questions.
- Never ignore MEMORY if it exists.
- Never hallucinate.
`,
  model: openai("gpt-4o-mini"),
});

export async function callLLM(
  question: string,
  context: string,
  history: any[] = [],
  memoryText: string = ""
): Promise<string> {
  const messages = [
    { role: "system", content: `MEMORY:\n${memoryText}` },
    { role: "system", content: `DOCUMENT CONTEXT:\n${context}` },
    ...history,
    { role: "user", content: question },
  ];

  const result = await mastra.generate(messages);
  return result.text;
}
