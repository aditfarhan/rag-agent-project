import { Router } from "express";
import { pool } from "../utils/db";
import { embedText } from "../service/embedding";

const router = Router();

router.post("/", async (req, res) => {
  try {
    const { query } = req.body;

    if (!query) return res.status(400).json({ error: "query is required" });

    // 1. Embed query text
    const embedding = await embedText(query);

    // Convert JS array -> pgvector literal string
    const vectorString = `[${embedding.join(",")}]`;

    // 2. Run vector similarity search
    const result = await pool.query(
      `
      SELECT
        id,
        document_id,
        chunk_index,
        content,
        1 - (embedding <=> $1::vector) AS similarity
      FROM chunks
      ORDER BY similarity DESC
      LIMIT 5;
      `,
      [vectorString]
    );

    res.json({
      query,
      results: result.rows,
    });
  } catch (error: any) {
    console.error("Search error:", error);
    res.status(500).json({ error: "search failed", detail: error.message });
  }
});

export default router;
