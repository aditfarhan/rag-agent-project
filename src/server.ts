/**
 * Application entry point for the RAG + Mastra AI agent system.
 *
 * Initializes Express server, validates OpenAI configuration, registers all HTTP routes,
 * and configures error handling. Serves as the main orchestrator for the vector search,
 * memory management, and LLM-powered chat functionality.
 */
import dotenv from "dotenv";
import express from "express";

import { config } from "@config/index";
import { validateOpenAIKey } from "@infra/llm/OpenAIAdapter";
import { errorHandler } from "@middleware/errorHandler";
import { registerRoutes } from "@routes/index";

dotenv.config();
validateOpenAIKey();

const app = express();
app.use(express.json());

registerRoutes(app);

app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`🚀 Server running on http://localhost:${config.port}`);

  console.log("OpenAI model:", config.openai.model);
});
