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
Answer ONLY using the document context and memory context.
If unknown say "I don't know from the document."`,
    },
    { role: "system", content: `MEMORY:\n${memoryText}` },
    { role: "system", content: `DOCUMENT CONTEXT:\n${context}` },
    ...history,
    { role: "user", content: question },
  ];

  try {
    const result = await mastra.generate(messages);
    return result.text;
  } catch (err) {
    console.error("LLM ERROR:", err);
    throw err;
  }
}
