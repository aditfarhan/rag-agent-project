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
  history: any[] = []
): Promise<string> {
  const messages = [
    ...history,
    {
      role: "system",
      content: `Use the context below to answer \n\n${context}`,
    },
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
