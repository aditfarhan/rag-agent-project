import dotenv from "dotenv";
dotenv.config();

import OpenAI from "openai";
import { client } from "../service/openAIClient.ts";

export type AgentResponse = {
  answer: string;
  raw?: any;
};

const OPENAI_KEY = process.env.OPENAI_API_KEY;

/**
 * Pluggable LLM caller.
 * - If OPENAI_API_KEY is missing or === "mock-key", returns a mocked answer.
 * - Otherwise uses OpenAI chat completions (can be replaced with Mastra SDK).
 */
export async function callLLM(
  prompt: string,
  model = "gpt-4o-mini",
  maxTokens = 512
): Promise<AgentResponse> {
  // Mock fallback (useful for tests / offline dev)
  if (!OPENAI_KEY || OPENAI_KEY === "mock-key") {
    const mockAnswer = `MOCK ANSWER: This is a mocked response. Prompt length=${prompt.length}`;
    return { answer: mockAnswer, raw: { mocked: true } };
  }

  try {
    const completion = await client.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content:
            "You are a helpful assistant that answers based only on provided context.",
        },
        { role: "user", content: prompt },
      ],
      max_tokens: maxTokens,
    });

    const answer = completion.choices?.[0]?.message?.content ?? "No response";
    return { answer, raw: completion };
  } catch (err: any) {
    // Wrap the error so callers can surface a friendly message
    throw new Error(`LLM call failed: ${String(err.message ?? err)}`);
  }
}
