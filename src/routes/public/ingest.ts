// src/routes/ingest.ts
import { ingestController } from "@interfaces/http/IngestController";
import { Router } from "express";

const router = Router();

// Delegate HTTP handling to the IngestController, which in turn calls IngestUseCase
router.post("/", ingestController);

export default router;
