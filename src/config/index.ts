import dotenv from "dotenv";
dotenv.config();

const openaiKey = process.env.OPENAI_API_KEY;

// ❗ Fail fast if missing
if (!openaiKey) {
  throw new Error(
    "OPENAI_API_KEY is missing. Please set it in your .env file."
  );
}

export const config = {
  openai: {
    key: openaiKey,
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
  },
  port: process.env.PORT || 3000,
  rag: {
    topK: Number(process.env.RAG_TOP_K || 5),
    distanceThreshold: Number(process.env.RAG_DISTANCE_THRESHOLD || 1.2),
  },
  memory: {
    similarTopK: Number(process.env.MEMORY_SIMILAR_TOP_K || 5),
  },
};
