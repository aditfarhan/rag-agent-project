/**
 * Ingest application use-case.
 *
 * Normalizes markdown-like documents, chunks them into semantically sized
 * segments, embeds all chunks via the shared embedding provider, and writes
 * them into the Postgres + pgvector-backed `documents` and `chunks` tables.
 * This module contains no HTTP concerns and is invoked by the ingest controller.
 */
import fs from "fs";

import MarkdownIt from "markdown-it";

import { pool } from "@infra/database/db";
import { embedBatch } from "@infra/llm/EmbeddingProvider";
import { logEvent } from "@infra/logging/Logger";
import { toPgVectorLiteral } from "@utils/vector";

import type { StatusCodeError } from "../../types/StatusCodeError";

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
 * Mirrors the original cleaning logic, but centralized in a use-case.
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
 * This function is designed to be called from the /api/documents/ingest route
 * while preserving the existing HTTP API contract.
 */
interface IngestFailureError extends Error {
  statusCode?: number;
}

interface IngestCatchErrorShape {
  message?: unknown;
  name?: unknown;
  statusCode?: unknown;
}

export async function ingestDocument(
  input: IngestRequest
): Promise<IngestResult> {
  const { filepath, title = "Uploaded Doc" } = input;

  if (!filepath) {
    const err: StatusCodeError = new Error("filepath required");
    err.statusCode = 400;
    throw err;
  }

  if (!fs.existsSync(filepath)) {
    const err: StatusCodeError = new Error("file not found");
    err.statusCode = 404;
    throw err;
  }

  const fileStats = fs.statSync(filepath);
  if (fileStats.size > 5 * 1024 * 1024) {
    const err: StatusCodeError = new Error("File too large (max 5MB)");
    err.statusCode = 400;
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
      message:
        typeof caught.message === "string" ? caught.message : String(error),
      name: typeof caught.name === "string" ? caught.name : undefined,
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
