// src/routes/ingest.ts
import { Router } from "express";
import path from "path";
import { ingestDocument } from "../../services/ingestService";

const router = Router();

router.post("/", async (req, res) => {
  try {
    const { filepath, title = "Uploaded Doc" } = req.body;
    const normalizedPath = path.resolve(filepath);

    const result = await ingestDocument({ filepath: normalizedPath, title });

    return res.json({
      status: "ok",
      documentId: result.documentId,
      totalChunks: result.totalChunks,
      inserted: result.inserted,
    });
  } catch (err: any) {
    const status = err?.statusCode ?? 500;

    if (status === 400 || status === 404) {
      return res.status(status).json({ error: err.message });
    }

    console.error("Ingest error:", err);

    return res.status(500).json({
      error: "ingest failed",
      detail: String(err?.message ?? err),
    });
  }
});

export default router;
