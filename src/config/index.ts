import dotenv from "dotenv";
dotenv.config();

export const config = {
  openaiKey: process.env.OPENAI_API_KEY || "mock-key",
  model: process.env.OPENAI_MODEL || "gpt-4o-mini",
  ragTopK: Number(process.env.RAG_TOP_K || 5),
  similarityThreshold: Number(process.env.RAG_SIMILARITY_THRESHOLD || 0.75),
  port: process.env.PORT || 3000,
};
