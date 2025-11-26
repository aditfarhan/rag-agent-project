// src/routes/chat.ts
import { Router } from "express";
import { handleChat } from "../services/chatService";

const router = Router();

router.post("/", async (req, res) => {
  try {
    const { question, history = [], userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: "userId is required" });
    }

    if (!question) {
      return res.status(400).json({ error: "question required" });
    }

    const result = await handleChat({
      userId,
      question,
      history,
    });

    return res.json(result);
  } catch (err: any) {
    err.statusCode = err.statusCode || 500;
    err.message = err.message || "Chat processing failed";
    throw err; // Pass to global middleware
  }
});

export default router;
