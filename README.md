# RAG Agent — Vector Search Chatbot (Node.js + TypeScript)

This service is a production-ready Retrieval-Augmented Generation (RAG) backend implementing:

- Chat orchestration with long-term memory + policy reasoning
- Markdown ingestion and chunking
- Embedding generation via an OpenAI-compatible API
- PostgreSQL + pgvector based vector store
- Semantic search and RAG-based answering

It is designed as a backend-only service (no UI) and is safe to run in production environments. All refactors preserve the original runtime behaviour, response shapes, prompts, thresholds, and decision logic.

---

## Project Overview

This project exposes a small set of HTTP endpoints to:

- Ingest markdown-like documents into a vector store (`/api/documents/ingest`)
- Answer user questions using:
  - User-specific memory (facts + chat history)
  - Policy / document content (RAG over ingested docs)
- Perform internal semantic search over existing chunks

The service is built as a Clean Architecture / hexagonal-style Node.js application with clear boundaries between:

- **Domain** (pure rules and intent logic)
- **Application** (use-cases)
- **Infrastructure** (DB, LLM, logging)
- **Interfaces / HTTP** (controllers, schemas, DTOs)
- **Routes + middleware** (Express wiring)

---

## Tech Stack

- **Runtime**
  - Node.js 20+
  - TypeScript 5+
  - Express 5 (`@types/express`)

- **Database**
  - PostgreSQL 15+ with `pgvector` extension
  - [`pg`](src/infrastructure/database/db.ts:1) for pooling

- **Vector & LLM**
  - [`openai`](src/infrastructure/llm/OpenAIAdapter.ts:1) (OpenAI-compatible REST client)
  - [`@ai-sdk/openai`](src/infrastructure/llm/OpenAIAdapter.ts:1) + [`@mastra/core`](src/infrastructure/llm/OpenAIAdapter.ts:1) for the Mastra-based LLM agent
  - [`markdown-it`](src/app/ingest/IngestUseCase.ts:1) for markdown normalization

- **Validation & Tooling**
  - [`zod`](src/interfaces/http/chat/schema.ts:1) for request/response schemas
  - ESLint 9 + `typescript-eslint`
  - Prettier 3
  - [`tsx`](package.json:6) for dev-time TypeScript execution
  - Type definitions: `@types/node`, `@types/express`, `@types/markdown-it`, `@types/pg`

---

## Architecture

The codebase follows a layered, Clean Architecture style:

### Domain Layer (Business Rules)

Domain modules implement pure business rules, without depending on Express or specific infrastructure.

- **Chat intent & heuristics**
  - [`src/domain/chat/IntentClassifier.ts`](src/domain/chat/IntentClassifier.ts:1)
    - LLM-based dynamic fact extraction (`extractDynamicKeyFact`)
    - High-level intent detection (`detectHighLevelIntent`)
    - Garbage / nonsense detection (`isGarbageQuestion`)
    - Regex-based policy and personal-question detection (`POLICY_REGEX`, `PERSONAL_QUESTION_REGEX`)

- **Memory**
  - [`src/domain/memory/memoryManager.ts`](src/domain/memory/memoryManager.ts:1)
    - Memory types: facts vs chat
    - Intelligent retrieval: similarity + recency + type boost
    - Domain-level API: `saveMemory`, `retrieveMemory`, `getLatestFactsByKey`, `getRecentUserMemories`

  - [`src/domain/memory/ports.ts`](src/domain/memory/ports.ts:1)
    - `MemoryRepository` port used by the domain / application layer

- **RAG**
  - [`src/domain/rag/ragEngine.ts`](src/domain/rag/ragEngine.ts:1)
    - RAG context retrieval (`getRagContextForQuery`)
    - Chunk-to-text context builder (`buildContextFromChunks`)
    - Semantic search (`semanticSearch`)

  - [`src/domain/rag/ports.ts`](src/domain/rag/ports.ts:1)
    - RAG repository port

- **LLM Port**
  - [`src/domain/llm/ports.ts`](src/domain/llm/ports.ts:1)
    - LLM port used by domain/application, implemented in infrastructure.

Domain rules **must not** import Express or concrete infrastructure modules. They depend only on ports and configuration.

---

### Application Layer (Use-Cases)

Application modules orchestrate domain logic and infrastructure ports to fulfill use-cases. They are called by controllers and must not know about HTTP or routing.

- **Chat Use-Case**
  - [`src/app/chat/ChatUseCase.ts`](src/app/chat/ChatUseCase.ts:424)
    - Main entry: `handleChat(request)`
    - Responsibilities:
      - Validate and normalize incoming question
      - Short-circuit for fixed patterns (e.g. “My name is …”, “I like …”)
      - Call `IntentClassifier` for dynamic fact extraction and intent
      - Retrieve RAG context and memory via domain modules
      - Call LLM via `callLLM` while preserving all existing prompts and behaviour
      - Persist assistant answers into memory
      - Return the original chat response shape (`answer`, `history`, `contextUsed`, `memoryUsed`, `meta`)

- **Ingest Use-Case**
  - [`src/app/ingest/IngestUseCase.ts`](src/app/ingest/IngestUseCase.ts:91)
    - Entry: `ingestDocument({ filepath, title? })`
    - Responsibilities:
      - Validate file existence and size
      - Normalize markdown to text
      - Chunk text into windowed segments
      - Generate batched embeddings via `EmbeddingProvider`
      - Insert into `documents` and `chunks` tables
      - Preserve behaviour when a document already exists (skip ingest, return 0 inserted)

- **Search Use-Case**
  - [`src/app/search/SearchUseCase.ts`](src/app/search/SearchUseCase.ts:25)
    - Entry: `searchDocumentsByText({ query, limit? })`
    - Responsibilities:
      - Validate non-empty query
      - Generate embedding
      - Delegate to domain `semanticSearch`
      - Return `SemanticSearchResponse` (query + chunk rows)

---

### Infrastructure Layer (Adapters)

Infrastructure modules implement persistence, LLM integration, and logging. They satisfy domain/application ports.

- **Database**
  - [`src/infrastructure/database/db.ts`](src/infrastructure/database/db.ts:1)
    - Creates a pg `Pool` using config values.

  - [`src/infrastructure/database/PostgresMemoryRepository.ts`](src/infrastructure/database/PostgresMemoryRepository.ts:1)
    - Implements `MemoryRepository` for PostgreSQL.
    - Handles:
      - FACT vs CHAT upsert/append behaviour
      - Optional `conversation_id` grouping (when column exists)
      - Intelligent retrieval scoring and logging.

  - [`src/infrastructure/database/PgVectorRagRepository.ts`](src/infrastructure/database/PgVectorRagRepository.ts:1)
    - Encapsulates queries against `chunks` using pgvector.
    - Used by `ragEngine` for RAG and semantic search.

- **LLM & Embeddings**
  - [`src/infrastructure/llm/OpenAIAdapter.ts`](src/infrastructure/llm/OpenAIAdapter.ts:1)
    - Shared OpenAI REST client (`client`)
    - Mastra agent (`mastra`) with preserved instructions and model
    - Core `callLLM(question, context, history, memoryText)`
    - `withRetry(fn, operation)` for transient error retries with backoff
    - `llmPort` implementing the domain LLM port
    - `validateOpenAIKey()` non-fatal connectivity check

  - [`src/infrastructure/llm/EmbeddingProvider.ts`](src/infrastructure/llm/EmbeddingProvider.ts:1)
    - `embedText(text)` and `embedBatch(texts)` using the shared OpenAI client
    - Emits embedding success/failure events
    - Uses retry wrapper for transient embedding errors

- **Logging**
  - [`src/core/logging/index.ts`](src/core/logging/index.ts:1)
    - `LoggerPort` interface (domain-facing logging contract).

  - [`src/infrastructure/logging/Logger.ts`](src/infrastructure/logging/Logger.ts:1)
    - Concrete logger implementing `LoggerPort`
    - Writes structured JSON lines to `logs/app.log` and to console
    - Provides `logEvent(type, payload)` for event-style logging.

  - [`src/utils/logger.ts`](src/utils/logger.ts:1)
    - Shim that re-exports `logger` and `logEvent` from infrastructure for convenience and backward compatibility.

---

### Interfaces / HTTP Layer

- **Controllers**
  - [`src/interfaces/http/ChatController.ts`](src/interfaces/http/ChatController.ts:1)
    - Thin adapter from `Request` to `ChatUseCase.handleChat()`, with Zod validation.

  - [`src/interfaces/http/IngestController.ts`](src/interfaces/http/IngestController.ts:1)
    - Thin adapter from HTTP body to `ingestDocument()`.

  - [`src/interfaces/http/SearchController.ts`](src/interfaces/http/SearchController.ts:1)
    - Thin adapter from HTTP body to `searchDocumentsByText()`.

- **Schemas & DTOs**
  - [`src/interfaces/http/chat/schema.ts`](src/interfaces/http/chat/schema.ts:1)
  - [`src/interfaces/http/ingest/schema.ts`](src/interfaces/http/ingest/schema.ts:1)
  - [`src/interfaces/http/search/schema.ts`](src/interfaces/http/search/schema.ts:1)
  - [`src/interfaces/http/dto/*.ts`](src/interfaces/http/dto/ApiResponse.ts:1) — type-only DTOs for documentation and typing.

### Routes & Middleware

- [`src/routes/index.ts`](src/routes/index.ts:1)
  - Central route registration for all routers.

- [`src/routes/public/chat.ts`](src/routes/public/chat.ts:1)
- [`src/routes/public/ingest.ts`](src/routes/public/ingest.ts:1)
- [`src/routes/public/health.ts`](src/routes/public/health.ts:1)
- [`src/routes/internal/search.ts`](src/routes/internal/search.ts:1)

- [`src/middleware/errorHandler.ts`](src/middleware/errorHandler.ts:1)
  - Global Express error middleware; centralizes HTTP error output.

### Config, Types, and Utils

- [`src/config/index.ts`](src/config/index.ts:1) — env + application config
- [`src/config/memoryKeys.ts`](src/config/memoryKeys.ts:1) — identity keys for memory
- [`src/types/errors.ts`](src/types/errors.ts:1) — shared error classes
- [`src/types/ChatMeta.ts`](src/types/ChatMeta.ts:1) — internal chat meta types
- [`src/utils/vector.ts`](src/utils/vector.ts:1) — simple PG vector helpers
- [`src/utils/logger.ts`](src/utils/logger.ts:1) — logging shim

---

## Installation

1. Clone the repository:

   ```bash
   git clone <your-repo-url>
   cd rag-agent-project
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Ensure PostgreSQL is running and accessible.

---

## Database Setup

Enable `pgvector` and create required tables:

```sql
CREATE DATABASE rag_agent;
\c rag_agent;
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE documents (
  id SERIAL PRIMARY KEY,
  title TEXT,
  filepath TEXT
);

CREATE TABLE chunks (
  id SERIAL PRIMARY KEY,
  document_id INTEGER REFERENCES documents(id) ON DELETE CASCADE,
  chunk_index INTEGER,
  content TEXT,
  embedding vector(1536)
);

CREATE TABLE user_memories (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  embedding vector(1536) NOT NULL,
  memory_key TEXT NULL,
  memory_type TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

If your schema already exists, keep it unchanged to preserve behaviour.

---

## Environment Variables

All configuration is centralized in [`src/config/index.ts`](src/config/index.ts:1).

Create a `.env` file at project root (example):

```env
# Server
PORT=3000
NODE_ENV=development

# PostgreSQL
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=postgres
DB_NAME=rag_agent
DB_POOL_MAX=10
DB_IDLE_TIMEOUT_MS=30000
DB_CONN_TIMEOUT_MS=10000

# OpenAI / compatible provider
OPENAI_API_KEY=your_api_key_here
OPENAI_MODEL=gpt-4o-mini
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
OPENAI_BASE_URL=
OPENAI_TIMEOUT_MS=30000

# RAG + Memory
RAG_TOP_K=5
RAG_DISTANCE_THRESHOLD=1.2
MEMORY_SIMILAR_TOP_K=5
```

> **Important:** Do **not** commit `.env` to source control. Use environment-specific secrets management in production.

---

## Running the Service

### Development

Start the dev server with live reload:

```bash
npm run dev
```

- Uses `tsx` to run [`src/server.ts`](src/server.ts:1) directly.
- Binds to `http://localhost:${PORT}` (default 3000).

### Production

Build and run the compiled server:

```bash
npm run build
npm start
```

- `npm run build` runs `tsc` (no emit in dev, emit for build).
- `npm start` runs `node dist/server.js`.

Use a process manager (systemd, PM2, Docker/Kubernetes, etc.) for production deployments.

---

## Endpoints Overview

### Health Check

- **Method**: `GET`
- **Route**: `/api/health`
- **Route Module**: [`src/routes/public/health.ts`](src/routes/public/health.ts:1)
- **Description**: Verifies process health and optionally performs a lightweight LLM connectivity check.

Example:

```bash
curl -X GET http://localhost:3000/api/health
```

---

### Ingest Markdown Document

- **Method**: `POST`
- **Route**: `/api/documents/ingest`
- **Route Module**: [`src/routes/public/ingest.ts`](src/routes/public/ingest.ts:1)
- **Controller**: [`src/interfaces/http/IngestController.ts`](src/interfaces/http/IngestController.ts:1)
- **Use-Case**: [`ingestDocument`](src/app/ingest/IngestUseCase.ts:91)

**Request Body:**

```json
{
  "filepath": "/absolute/path/to/docs/policy.md",
  "title": "Optional Title"
}
```

**Example:**

```bash
curl -X POST http://localhost:3000/api/documents/ingest \
  -H "Content-Type: application/json" \
  -d '{"filepath":"./docs/policy.md","title":"HR Policy"}'
```

**Response:**

```json
{
  "documentId": 1,
  "totalChunks": 42,
  "inserted": 42
}
```

Shape is preserved exactly; `totalChunks` and `inserted` reflect chunking and upsert behaviour.

---

### Chat Endpoint

- **Method**: `POST`
- **Route**: `/api/chat`
- **Route Module**: [`src/routes/public/chat.ts`](src/routes/public/chat.ts:1)
- **Controller**: [`src/interfaces/http/ChatController.ts`](src/interfaces/http/ChatController.ts:1)
- **Use-Case**: [`handleChat`](src/app/chat/ChatUseCase.ts:424)

**Request Body:**

```json
{
  "userId": "user-123",
  "question": "What does the policy say about working hours?",
  "history": []
}
```

**Example:**

```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"userId":"user-123","question":"What does the policy say about working hours?"}'
```

**Response Shape (unchanged):**

```json
{
  "answer": "string",
  "history": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ],
  "contextUsed": [
    {
      "id": 1,
      "document_id": 1,
      "chunk_index": 0,
      "content": "..."
    }
  ],
  "memoryUsed": true,
  "meta": {
    "rag": {
      "topK": 5,
      "distanceThreshold": 1.2,
      "chunksReturned": 3
    },
    "memory": {
      "similarTopK": 5,
      "factsCount": 2
    }
  }
}
```

All field names and semantics are preserved from the original implementation.

---

### Internal Semantic Search

- **Method**: `POST`
- **Route**: `/api/internal/search`
- **Route Module**: [`src/routes/internal/search.ts`](src/routes/internal/search.ts:1)
- **Controller**: [`src/interfaces/http/SearchController.ts`](src/interfaces/http/SearchController.ts:1)
- **Use-Case**: [`searchDocumentsByText`](src/app/search/SearchUseCase.ts:25)

**Request Body:**

```json
{
  "query": "jam kerja",
  "limit": 5
}
```

**Example:**

```bash
curl -X POST http://localhost:3000/api/internal/search \
  -H "Content-Type: application/json" \
  -d '{"query":"jam kerja","limit":5}'
```

**Response Shape:**

```json
{
  "query": "jam kerja",
  "results": [
    {
      "id": 10,
      "document_id": 1,
      "chunk_index": 0,
      "content": "Jam kerja standar...",
      "distance": 0.123,
      "similarity": 0.877
    }
  ]
}
```

---

## Error Handling Model

- All thrown errors pass through [`src/middleware/errorHandler.ts`](src/middleware/errorHandler.ts:1).
- Domain and infrastructure code may:
  - Throw `Error` instances augmented with a `statusCode` (legacy pattern), or
  - Throw structured errors derived from [`src/types/errors.ts`](src/types/errors.ts:1).

The global handler:

- Preserves existing HTTP status codes and top-level `message`.
- Wraps unknown errors in a consistent JSON error shape without altering previous behaviour.

---

## Memory & RAG Behaviour

### Memory

- Personal facts (identity, preferences, etc.) are stored as `memory_type = 'fact'` rows in `user_memories`.
- Chat history turns are stored as `memory_type = 'chat'`.
- Facts are upserted per `(user_id, memory_key)`; chat entries are appended.
- `retrieveMemory` combines:
  - Vector similarity (via pgvector)
  - Recency (based on `updated_at`)
  - Type boost (facts are weighted higher)

### RAG

- For relevant queries, chat orchestration:
  - Embeds the question
  - Calls `getRagContextForQuery` to retrieve and filter candidate chunks
  - Builds a context string and passes it to the LLM

- If distance-filtering yields no chunks, behaviour falls back to an earlier, known-good mode (using the top-K unfiltered set) to avoid regressions.

All thresholds (`RAG_TOP_K`, `RAG_DISTANCE_THRESHOLD`, `MEMORY_SIMILAR_TOP_K`) and handlers for “no context” or “unknown answer” are preserved exactly.

---

## Design Goals

- Preserve **all** original runtime behaviour and outputs.
- Enforce clean, layered architecture:
  - Domain & ports do not import Express or infra.
  - Application orchestrates domain and ports without HTTP concerns.
  - Infrastructure modules encapsulate external details (DB, LLM, logging).
  - Interfaces/http controllers remain thin.

- Improve testability by isolating:
  - Memory logic
  - RAG retrieval logic
  - Chat orchestration
  - LLM adapter

- Ensure robust error handling and structured logging while keeping responses unchanged.

---

## How to Run Tests

There is currently no formal automated test suite wired into `npm test`. The default script is a placeholder.

For now, validation is performed via:

- Type-checking:

  ```bash
  npx tsc --noEmit
  ```

- Linting (if you choose to run eslint):

  ```bash
  npx eslint .
  ```

- Manual curl-based checks using the examples in this README, against a seeded PostgreSQL database and the provided [`docs/policy.md`](docs/policy.md:1).

---

## How to Extend the System

When adding new features, follow the established architecture:

1. **New domain rule**
   - Add a new function or type to the appropriate domain module (e.g. [`domain/chat`](src/domain/chat/IntentClassifier.ts:1), [`domain/memory`](src/domain/memory/memoryManager.ts:1), [`domain/rag`](src/domain/rag/ragEngine.ts:1)).
   - Ensure it does not import infrastructure modules directly.

2. **New use-case**
   - Create a new module in `src/app/<feature>` that orchestrates domain functions and ports.
   - Accept typed inputs/outputs; no Express objects.

3. **New HTTP endpoint**
   - Add a new controller under `src/interfaces/http/<feature>`.
   - Define request/response schemas with `zod`.
   - Wire the controller in `src/routes`.

4. **New infrastructure adapter**
   - Implement a port in `src/infrastructure/<area>`.
   - Keep DB/LLM/logging code isolated here.

5. **Logging and errors**
   - Use `logger.log(level, message, meta)` or `logEvent(type, payload)` via [`src/utils/logger.ts`](src/utils/logger.ts:1).
   - Throw structured errors from [`src/types/errors.ts`](src/types/errors.ts:1) when appropriate, but keep existing error messages and statuses intact unless explicitly changing behaviour.

By following this pattern, you can safely evolve capabilities without breaking existing APIs or changing their established behaviour.

---

This README documents the **current** architecture and behaviour after the refactor, without introducing any new API features or changing existing responses.
