import dotenv from "dotenv";
import express from "express";

import { config } from "./config";
import { validateOpenAIKey } from "./infrastructure/llm/OpenAIAdapter";
import { errorHandler } from "./middleware/errorHandler";
import { registerRoutes } from "./routes";

dotenv.config();
validateOpenAIKey(); // ✅ now validated on startup

const app = express();
app.use(express.json());

// Step 10: central route registration; behaviour and paths remain unchanged.
registerRoutes(app);

app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`🚀 Server running on http://localhost:${config.port}`);

  console.log("OpenAI model:", config.openai.model);
});
