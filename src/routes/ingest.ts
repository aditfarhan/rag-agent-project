// src/routes/ingest.ts
import { Router } from "express";
import fs from "fs";
import MarkdownIt from "markdown-it";
import { embedText } from "../service/embedding";
import { pool } from "../utils/db";

const router = Router();
const md = new MarkdownIt();

// chunk text by paragraphs, fallback to fixed-size sliding window
function chunkText(text: string, maxLen = 800) {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks: string[] = [];

  for (const p of paragraphs) {
    if (p.length <= maxLen) {
      chunks.push(p);
    } else {
      // slide over long paragraph
      let start = 0;
      while (start < p.length) {
        chunks.push(p.slice(start, start + maxLen).trim());
        start += maxLen;
      }
    }
  }

  // if no paragraphs (very short doc), fallback to full text
  if (chunks.length === 0 && text.trim().length > 0) {
    let start = 0;
    while (start < text.length) {
      chunks.push(text.slice(start, start + maxLen).trim());
      start += maxLen;
    }
  }

  return chunks.filter(Boolean);
}

router.post("/", async (req, res) => {
  const client = await pool.connect();

  try {
    const { filepath, title = "Uploaded Doc" } = req.body;

    if (!filepath) return res.status(400).json({ error: "filepath required" });
    if (!fs.existsSync(filepath))
      return res.status(404).json({ error: "file not found" });

    const fileStats = fs.statSync(filepath);
    if (fileStats.size > 5 * 1024 * 1024) {
      return res.status(400).json({ error: "File too large (max 5MB)" });
    }

    const raw = fs.readFileSync(filepath, "utf-8");

    const textOnly = raw
      .replace(/(`{1,3}[\s\S]*?`{1,3})/g, "")
      .replace(/!\[.*?\]\(.*?\)/g, "")
      .replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, "$1")
      .replace(/[#>*_\-`]/g, "")
      .replace(/\n{2,}/g, "\n\n")
      .trim();

    const chunks = chunkText(textOnly, 800);

    await client.query("BEGIN");

    // prevent duplicate documents
    const existingDoc = await client.query(
      "SELECT id FROM documents WHERE filepath = $1",
      [filepath]
    );

    let documentId: number;

    if (existingDoc.rows.length > 0) {
      documentId = existingDoc.rows[0].id;
    } else {
      const doc = await client.query(
        "INSERT INTO documents (title, filepath) VALUES ($1, $2) RETURNING id",
        [title, filepath]
      );
      documentId = doc.rows[0].id;
    }

    let inserted = 0;

    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i];
      if (!c || !c.trim()) continue;

      const embedding = await embedText(c);
      if (!Array.isArray(embedding) || embedding.length === 0) continue;

      const vectorLiteral = `[${embedding.join(",")}]`;

      await client.query(
        `INSERT INTO chunks (document_id, chunk_index, content, embedding) 
         VALUES ($1, $2, $3, $4)
         ON CONFLICT DO NOTHING`,
        [documentId, i, c, vectorLiteral]
      );

      inserted++;
    }

    await client.query("COMMIT");

    res.json({
      status: "ok",
      documentId,
      totalChunks: chunks.length,
      inserted,
    });
  } catch (err) {
    await pool.query("ROLLBACK");
    console.error("Ingest error:", err);
    res.status(500).json({ error: "ingest failed", detail: String(err) });
  } finally {
    client.release();
  }
});

export default router;
