// src/routes/chat.ts
import { chatController } from "@interfaces/http/ChatController";
import { Router } from "express";

const router = Router();

// Delegate the HTTP handling to the ChatController, which in turn calls ChatUseCase
router.post("/", chatController);

export default router;
