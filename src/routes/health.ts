import { Router } from "express";
import { callLLM } from "../service/mastraAgent";

const router = Router();

router.get("/", async (_req, res) => {
  try {
    const test = await callLLM("ping", "", [], "");
    res.json({
      status: "ok",
      llm: "connected",
      response: test,
    });
  } catch (error: any) {
    res.status(500).json({
      status: "error",
      llm: "disconnected",
      detail: error.message,
    });
  }
});

export default router;
