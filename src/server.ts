import express from "express";
import dotenv from "dotenv";

import ingestRouter from "./routes/ingest";
import chatRoute from "./routes/chat";
import searchRoute from "./routes/search";
import ragRoutes from "./routes/rag";
import healthRouter from "./routes/health";

import { errorHandler } from "./middleware/errorHandler";
import { validateOpenAIKey } from "./utils/validateOpenAI";
import { config } from "./config";

dotenv.config();
validateOpenAIKey(); // ✅ now validated on startup

const app = express();
app.use(express.json());

app.use("/api/ingest", ingestRouter);
app.use("/api/chat", chatRoute);
app.use("/api/search", searchRoute);
app.use("/api/rag", ragRoutes);
app.use("/api/health", healthRouter);

app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`🚀 Server running on http://localhost:${config.port}`);
  console.log("OpenAI model:", config.openai.model);
});
