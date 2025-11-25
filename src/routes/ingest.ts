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
  try {
    const { filepath, title = "Uploaded Doc" } = req.body;

    if (!filepath) return res.status(400).json({ error: "filepath required" });
    if (!fs.existsSync(filepath))
      return res.status(404).json({ error: "file not found" });

    const raw = fs.readFileSync(filepath, "utf-8");

    // parse Markdown to plain-ish text
    const html = md.render(raw);
    const textOnly = raw
      .replace(/(`{1,3}[\s\S]*?`{1,3})/g, "") // remove inline/fenced code blocks
      .replace(/!\[.*?\]\(.*?\)/g, "") // remove images
      .replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, "$1") // convert links to text
      .replace(/[#>*_\-`]/g, "") // basic cleanup
      .replace(/\n{2,}/g, "\n\n")
      .trim();

    // create documents row
    const doc = await pool.query(
      "INSERT INTO documents (title, filepath) VALUES ($1, $2) RETURNING id",
      [title, filepath]
    );
    const documentId = doc.rows[0].id;

    // chunk the text
    const chunks = chunkText(textOnly, 800);
    let inserted = 0;

    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i];
      if (!c || typeof c !== "string" || c.trim().length === 0) continue;

      // create embedding
      const embedding = await embedText(c);

      // optional sanity check: ensure embedding dims match expected (1536)
      if (!Array.isArray(embedding) || embedding.length === 0) {
        console.warn(`Skipping chunk ${i}: embedding empty`);
        continue;
      }

      // Insert chunk with JSON stringified embedding (Postgres pgvector expects a literal like '[1,2,3]'
      // but using JSON.stringify is compatible if db param is passed correctly — keep consistent with your retrieval)
      await pool.query(
        `INSERT INTO chunks 
           (document_id, chunk_index, content, embedding) 
         VALUES ($1, $2, $3, $4)`,
        [documentId, i, c, JSON.stringify(embedding)]
      );

      inserted++;
    }

    return res.json({
      status: "ok",
      documentId,
      totalChunks: chunks.length,
      inserted,
    });
  } catch (err) {
    console.error("Ingest error:", err);
    return res
      .status(500)
      .json({ error: "ingest failed", detail: String(err) });
  }
});

export default router;
