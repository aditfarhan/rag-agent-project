import { callLLM } from "@infra/llm/OpenAIAdapter";
import { Router } from "express";

const router = Router();

router.get("/", async (_req, res) => {
  try {
    const test = await callLLM("ping", "", [], "");
    res.json({
      status: "ok",
      llm: "connected",
      response: test,
    });
  } catch (error: unknown) {
    const err = error as { message?: string };

    res.status(500).json({
      status: "error",
      llm: "disconnected",
      detail: err.message,
    });
  }
});

export default router;
