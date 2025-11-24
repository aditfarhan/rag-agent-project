import express from "express";
import dotenv from "dotenv";

import ingestRouter from "./routes/ingest";
import chatRoute from "./routes/chat";

dotenv.config();

const app = express();
app.use(express.json());
app.use("/api/ingest", ingestRouter);
app.use("/api/chat", chatRoute);

// health check

app.get("/health", (req, res) => {
  res.json({ status: "OK" });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
