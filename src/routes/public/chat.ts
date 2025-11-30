/**
 * Public chat API route for conversational AI.
 *
 * Express router exposing the Mastra AI agent chat interface:
 * - POST /api/chat: Main conversational endpoint with RAG + memory
 *
 * Primary user interface for the intelligent assistant system.
 */
import { chatController } from "@interfaces/http/ChatController";
import { Router } from "express";

const router = Router();

router.post("/", chatController);

export default router;
