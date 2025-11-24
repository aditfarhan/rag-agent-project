import OpenAI from "openai";

export const client = new OpenAI({
  apiKey:
    process.env.OPENAI_API_KEY ||
    "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",
});
