import fs from "fs";
import MarkdownIt from "markdown-it";
import { pool } from "../utils/db";
import { embedBatch } from "./embeddingService";
import { logEvent } from "../utils/logger";

const md = new MarkdownIt();

export interface IngestRequest {
  filepath: string;
  title?: string;
}

export interface IngestResult {
  documentId: number;
  totalChunks: number;
  inserted: number;
}

/**
 * Chunk text by paragraphs, with a fallback to a fixed-size sliding window.
 * This preserves the behavior of the original route-level implementation.
 */
function chunkText(text: string, maxLen = 800): string[] {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks: string[] = [];

  for (const p of paragraphs) {
    if (p.length <= maxLen) {
      chunks.push(p);
    } else {
      // Slide over long paragraphs
      let start = 0;
      while (start < p.length) {
        chunks.push(p.slice(start, start + maxLen).trim());
        start += maxLen;
      }
    }
  }

  // If no paragraphs (very short doc), fallback to full text windowing
  if (chunks.length === 0 && text.trim().length > 0) {
    let start = 0;
    while (start < text.length) {
      chunks.push(text.slice(start, start + maxLen).trim());
      start += maxLen;
    }
  }

  return chunks.filter(Boolean);
}

/**
 * Normalize raw markdown into plain text suitable for embedding.
 * Mirrors the original cleaning logic, but centralized in a service.
 */
function normalizeMarkdown(raw: string): string {
  const rendered = md.render(raw);

  const textOnly = rendered
    .replace(/(<code>[\s\S]*?<\/code>)/g, "")
    .replace(/(`{1,3}[\s\S]*?`{1,3})/g, "")
    .replace(/!\[.*?\]\(.*?\)/g, "")
    .replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, "$1")
    .replace(/[#*>_\-`]/g, "")
    .replace(/\n{2,}/g, "\n\n")
    .trim();

  return textOnly;
}

/**
 * Ingest a markdown-like document into the vector store.
 *
 * Behavior:
 * - Validates file existence and size.
 * - Normalizes markdown content to text.
 * - Chunks text using the same strategy as the original implementation.
 * - Uses batched embeddings for performance.
 * - Inserts chunks into the `chunks` table with pgvector embeddings.
 * - Prevents duplicate documents by filepath, reusing the existing document id.
 *
 * This function is designed to be called from the /api/ingest route while
 * preserving the existing HTTP API contract.
 */
export async function ingestDocument(
  input: IngestRequest
): Promise<IngestResult> {
  const { filepath, title = "Uploaded Doc" } = input;

  if (!filepath) {
    const err = new Error("filepath required");
    (err as any).statusCode = 400;
    throw err;
  }

  if (!fs.existsSync(filepath)) {
    const err = new Error("file not found");
    (err as any).statusCode = 404;
    throw err;
  }

  const fileStats = fs.statSync(filepath);
  if (fileStats.size > 5 * 1024 * 1024) {
    const err = new Error("File too large (max 5MB)");
    (err as any).statusCode = 400;
    throw err;
  }

  const raw = fs.readFileSync(filepath, "utf-8");
  const normalizedText = normalizeMarkdown(raw);
  const chunks = chunkText(normalizedText, 800);

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Prevent duplicate documents
    const existingDoc = await client.query(
      "SELECT id FROM documents WHERE filepath = $1",
      [filepath]
    );

    let documentId: number;

    if (existingDoc.rows.length > 0) {
      documentId = existingDoc.rows[0].id;

      // ✅ SAFETY STOP: Document already ingested
      logEvent("INGEST_SKIPPED", {
        filepath,
        reason: "Document already exists",
      });

      return {
        documentId,
        totalChunks: 0,
        inserted: 0,
      };
    } else {
      const doc = await client.query(
        "INSERT INTO documents (title, filepath) VALUES ($1, $2) RETURNING id",
        [title, filepath]
      );
      documentId = doc.rows[0].id;
    }

    let inserted = 0;

    if (chunks.length > 0) {
      // Batched embeddings for performance.
      const embeddings = await embedBatch(chunks);

      for (let i = 0; i < chunks.length; i++) {
        const c = chunks[i];
        const embedding = embeddings[i];

        if (!c || !c.trim() || !embedding || !embedding.length) {
          continue;
        }

        const vectorLiteral = `[${embedding.join(",")}]`;

        await client.query(
          `
          INSERT INTO chunks (document_id, chunk_index, content, embedding) 
          VALUES ($1, $2, $3, $4)
          ON CONFLICT DO NOTHING
          `,
          [documentId, i, c, vectorLiteral]
        );

        inserted++;
      }
    }

    await client.query("COMMIT");

    logEvent("INGEST_SUCCESS", {
      filepath,
      documentId,
      totalChunks: chunks.length,
      inserted,
    });

    return {
      documentId,
      totalChunks: chunks.length,
      inserted,
    };
  } catch (error: any) {
    await client.query("ROLLBACK");

    logEvent("INGEST_FAILURE", {
      filepath,
      message: error?.message || String(error),
      name: error?.name,
    });

    const err = error instanceof Error ? error : new Error("ingest failed");
    (err as any).statusCode = (error as any)?.statusCode || 500;
    throw err;
  } finally {
    client.release();
  }
}
