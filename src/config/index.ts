import dotenv from "dotenv";
dotenv.config();

export const config = {
  openai: {
    key: process.env.OPENAI_API_KEY,
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
