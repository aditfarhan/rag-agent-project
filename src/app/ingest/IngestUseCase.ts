/**
 * Document ingestion pipeline for RAG system.
 *
 * Handles end-to-end processing of markdown documents:
 * - Validates file existence and size constraints
 * - Normalizes markdown content to plain text
 * - Chunks text into semantically sized segments
 * - Generates vector embeddings for all chunks
 * - Stores documents and chunks in PostgreSQL + pgvector
 *
 * Integrates with the vector database to enable semantic search capabilities.
 */
import fs from "fs";

import { pool } from "@infrastructure/database/db";
import { embedBatch } from "@infrastructure/llm/EmbeddingProvider";
import { logEvent } from "@infrastructure/logging/Logger";
import type { StatusCodeErrorInterface } from "@typesLocal/StatusCodeError";
import { toPgVectorLiteral } from "@utils/vector";
import MarkdownIt from "markdown-it";

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
      let start = 0;
      while (start < p.length) {
        chunks.push(p.slice(start, start + maxLen).trim());
        start += maxLen;
      }
    }
  }

  if (chunks.length === 0 && text.trim().length > 0) {
    let start = 0;
    while (start < text.length) {
      chunks.push(text.slice(start, start + maxLen).trim());
      start += maxLen;
    }
  }

  return chunks.filter(Boolean);
}

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

interface IngestFailureError extends Error {
  statusCode?: number;
}

interface IngestCatchErrorShape {
  message?: string;
  name?: string;
  statusCode?: number;
}

export async function ingestDocument(
  input: IngestRequest
): Promise<IngestResult> {
  const { filepath, title = "Uploaded Doc" } = input;

  if (!filepath) {
    const err: StatusCodeErrorInterface = new Error("filepath required");
    err.statusCode = 400;
    throw err;
  }

  if (!fs.existsSync(filepath)) {
    const err: StatusCodeErrorInterface = new Error("file not found");
    err.statusCode = 404;
    throw err;
  }

  const fileStats = fs.statSync(filepath);
  if (fileStats.size > 5 * 1024 * 1024) {
    const err: StatusCodeErrorInterface = new Error("File too large (max 5MB)");
    err.statusCode = 400;
    throw err;
  }

  const raw = fs.readFileSync(filepath, "utf-8");
  const normalizedText = normalizeMarkdown(raw);
  const chunks = chunkText(normalizedText, 800);

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const existingDoc = await client.query(
      "SELECT id FROM documents WHERE filepath = $1",
      [filepath]
    );

    let documentId: number;

    if (existingDoc.rows.length > 0) {
      documentId = existingDoc.rows[0].id;

      // Prevent duplicate document ingestion - existing content remains authoritative
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
      const embeddings = await embedBatch(chunks);

      for (let i = 0; i < chunks.length; i++) {
        const c = chunks[i];
        const embedding = embeddings[i];

        if (!c || !c.trim() || !embedding || !embedding.length) {
          continue;
        }

        const vectorLiteral = toPgVectorLiteral(embedding);

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
  } catch (error: unknown) {
    await client.query("ROLLBACK");

    const caught = error as IngestCatchErrorShape;

    logEvent("INGEST_FAILURE", {
      filepath,
      message: caught.message ?? String(error),
      name: caught.name,
    });

    const err: IngestFailureError =
      error instanceof Error
        ? (error as IngestFailureError)
        : new Error("ingest failed");
    err.statusCode =
      typeof caught.statusCode === "number" ? caught.statusCode : 500;
    throw err;
  } finally {
    client.release();
  }
}
