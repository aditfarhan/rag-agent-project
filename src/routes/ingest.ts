import { Router } from "express";
import fs from "fs";
import MarkdownIt from "markdown-it";
import { embedText } from "../service/embedding";
import { pool } from "../utils/db";

const router = Router();
const md = new MarkdownIt();

// simple chunking
function chunkText(text: string, maxLen = 500) {
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    chunks.push(text.slice(start, start + maxLen));
    start += maxLen;
  }
  return chunks;
}

router.post("/", async (req, res) => {
  try {
    const { filepath } = req.body;

    if (!filepath) return res.status(400).json({ error: "filepath required" });
    if (!fs.existsSync(filepath))
      return res.status(404).json({ error: "file not found" });

    const raw = fs.readFileSync(filepath, "utf-8");

    // parse Markdown
    const html = md.render(raw);
    const textOnly = raw.replace(/[#>*_\-`]/g, ""); // simple cleanup

    // insert doc
    const doc = await pool.query(
      "INSERT INTO documents (title, filepath) VALUES ($1, $2) RETURNING id",
      ["Uploaded Doc", filepath]
    );
    const documentId = doc.rows[0].id;

    // chunking
    const chunks = chunkText(textOnly);

    // Filter invalid values first (recommended)
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i];

      if (!c || typeof c !== "string" || c.trim().length === 0) continue; // 🔥 FIX

      const embedding = await embedText(c);

      await pool.query(
        "INSERT INTO chunks (document_id, chunk_index, content, embedding) VALUES ($1, $2, $3, $4)",
        [documentId, i, c, `[${embedding.join(",")}]`]
      );
    }

    res.json({
      status: "ok",
      documentId,
      chunks: chunks.length,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "ingest failed" });
  }
});

export default router;
