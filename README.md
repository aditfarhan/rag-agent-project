# RAG Agent — Vector Search Chatbot (Node.js + TypeScript)

A production-ready Retrieval-Augmented Generation (RAG) backend with:

- Chat orchestration with long-term memory & policy reasoning
- Markdown ingestion & chunking
- Embedding generation via OpenAI‑compatible APIs
- PostgreSQL + pgvector vector search
- Semantic search and RAG-based answering

The system follows a strict Clean Architecture structure and includes robust error handling, logging, and strongly typed TypeScript modules.

---

## 📦 Project Structure (important files)

```
src
├── app
│   ├── chat/ChatUseCase.ts
│   ├── ingest/IngestUseCase.ts
│   └── search/SearchUseCase.ts
├── config
│   ├── index.ts
│   └── memoryKeys.ts
├── domain
│   ├── chat/IntentClassifier.ts
│   ├── llm/ports.ts
│   ├── memory/{memoryManager.ts, ports.ts}
│   └── rag/{ragEngine.ts, ports.ts}
├── infrastructure
│   ├── database/{db.ts, PgVectorRagRepository.ts, PostgresMemoryRepository.ts}
│   ├── llm/{EmbeddingProvider.ts, OpenAIAdapter.ts}
│   └── logging/Logger.ts
├── interfaces/http
│   ├── ChatController.ts
│   ├── IngestController.ts
│   ├── SearchController.ts
│   ├── chat/schema.ts
│   ├── ingest/schema.ts
│   └── search/schema.ts
├── middleware/errorHandler.ts
├── routes/public & routes/internal
├── types/{ChatMeta.ts, StatusCodeError.ts}
└── utils/vector.ts
```

---

## 🛠 Installation

1. Clone the repository:

```bash
git clone https://github.com/aditfarhan/rag-agent-project
cd rag-agent-project
```

2. Install dependencies:

```bash
npm install
```

Ensure **Node.js ≥ 20**, **PostgreSQL ≥ 15**, and the `pgvector` extension installed in PostgreSQL.

---

## ⚙ Environment variables (.env)

Create a `.env` file at the project root. Example below includes all configuration keys used by the code and README examples.

```env
# Server
PORT=3000
NODE_ENV=development
LOG_LEVEL=info

# PostgreSQL
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=postgres
DB_NAME=rag_agent
DB_POOL_MAX=10
DB_IDLE_TIMEOUT_MS=30000
DB_CONN_TIMEOUT_MS=10000

# OpenAI / compatible provider (or mock)
OPENAI_API_KEY=your_api_key_here
OPENAI_MODEL=gpt-4o-mini
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
OPENAI_TIMEOUT_MS=30000

# RAG + Memory
RAG_TOP_K=5
RAG_DISTANCE_THRESHOLD=1.2
MEMORY_SIMILAR_TOP_K=5
```

> **Important:** Do **not** commit `.env` to source control. Use secure secret management in production.

---

## 🗄 Database Setup (FULL SCHEMA + INDEXES + TRIGGERS)

Connect to PostgreSQL as a superuser (example uses `psql`):

```bash
psql -U postgres
```

Create database and enable `pgvector`:

```sql
CREATE DATABASE rag_agent;
\c rag_agent;
CREATE EXTENSION IF NOT EXISTS vector;
```

### Documents table

```sql
CREATE TABLE documents (
  id SERIAL PRIMARY KEY,
  title TEXT,
  chunk TEXT,
  embedding vector(1536),
  created_at TIMESTAMP DEFAULT NOW(),
  filepath TEXT,
  CONSTRAINT unique_filepath UNIQUE (filepath)
);
```

### Chunks table

```sql
CREATE TABLE chunks (
  id SERIAL PRIMARY KEY,
  document_id INTEGER REFERENCES documents(id) ON DELETE CASCADE,
  chunk_index INTEGER,
  content TEXT,
  embedding vector(1536),
  created_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT chunks_document_chunk_unique UNIQUE (document_id, chunk_index)
);

-- ivfflat index for vector search; lists tuned to 100 as example
CREATE INDEX idx_chunks_embedding
  ON chunks USING ivfflat (embedding) WITH (lists = 100);
```

### User memories table

```sql
CREATE TABLE user_memories (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  content TEXT NOT NULL,
  embedding vector(1536),
  created_at TIMESTAMP DEFAULT NOW(),
  role VARCHAR(20),
  token_count INTEGER DEFAULT 0,
  memory_key TEXT,
  updated_at TIMESTAMP DEFAULT NOW(),
  memory_type TEXT DEFAULT 'fact',
  CONSTRAINT unique_user_memory_key UNIQUE (user_id, memory_key)
);

CREATE INDEX idx_user_memories_embedding
  ON user_memories USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

CREATE INDEX idx_user_memories_user_id ON user_memories (user_id);
```

### Trigger function: update_timestamp()

This trigger updates `updated_at` on each UPDATE for `user_memories` (and can be reused).

```sql
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

Attach trigger to `user_memories`:

```sql
CREATE TRIGGER update_user_memories_timestamp
BEFORE UPDATE ON user_memories
FOR EACH ROW EXECUTE FUNCTION update_timestamp();
```

> Optional: Add any other triggers or retention policies (e.g., retention background job) as appropriate for your deployment.

---

## ✅ Verification: Example DB Seed + Index Checks

After creating tables and indexes, confirm indexes exist and `pgvector` is enabled:

```sql
\dx
-- list indexes and table structure
\d+ chunks
\d+ documents
\d+ user_memories
```

If `ivfflat` index requires `lists` tuning, you may reindex with a different `lists` value based on dataset size.

---

## 🚀 Running the Service

### Development (live reload)

```bash
npm run dev
```

Server runs at `http://localhost:${PORT || 3000}` by default.

### Production

```bash
npm run build
npm start
```

---

## 🌐 API Endpoints & E2E curl tests (including edge cases)

All requests assume server at `http://localhost:3000`. Adjust `PORT` if needed.

### 0. Health (simple)

```bash
curl -X GET http://localhost:3000/api/health
```

Expected: 200 OK JSON (keeps previous behaviour; may include light LLM connectivity check if configured).

---

### 1. Ingest Markdown Document (ingest `docs/policy.md` you provided)

This will read local file path; ensure `filepath` is accessible by the running process (beware absolute vs relative path):

```bash
curl -X POST http://localhost:3000/api/documents/ingest \
  -H "Content-Type: application/json" \
  -d '{"filepath":"./docs/policy.md","title":"HR Policy"}'
```

**Edge cases to test:**

- Missing file path → expect validation 400 from Zod
- File too large → expect ingestion to fail gracefully
- Duplicate `filepath` → ingest should detect existing doc and return inserted=0 or skip

---

### 2. Create / Store user personal preference (Farhan)

First store identity (fact) and preference messages that the system recognizes as facts (ChatUseCase handles simple "My name is..." flows):

Store identity:

```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "farhan",
    "question": "My name is Farhan",
    "history": []
  }'
```

Store preferences (coffee + football):

```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "farhan",
    "question": "I love strong black coffee and playing football",
    "history": []
  }'
```

Edge cases:

- Long userId strings
- Empty question → expect validation error
- Repeated identical fact (should be upsert on memory_key, not duplicate)

---

### 3. Retrieve personalized memory

Ask system what it remembers about Farhan:

```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "userId":"farhan",
    "question":"What do you remember about me?",
    "history": []
  }'
```

Expect: answer referencing stored facts ("Farhan" and preference for coffee and football).

---

### 4. Ask a policy question (RAG retrieving from ingested docs)

```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "userId":"farhan",
    "question":"What does the employee policy say about working hours?",
    "history": []
  }'
```

Expect: answer that cites policy content (e.g., "Standard working hours are Monday–Friday, 09:00–17:00...").

Edge case:

- RAG returns no chunk → system falls back to safe unknown answer path.

---

### 5. Combined personalized + policy question

```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "farhan",
    "question": "Considering I like football, how should I manage my schedule according to the company'\''s working hours?",
    "history": []
  }'
```

Expect: answer that merges personal preference and policy constraints (e.g., suggests scheduling training and matches outside core hours, discuss with manager for overtime approval, mention company working hours).

---

### 6. Internal semantic search (debugging)

```bash
curl -X POST http://localhost:3000/api/internal/search \
  -H "Content-Type: application/json" \
  -d '{"query":"annual leave policy","limit":5}'
```

Expect: list of chunks with `id`, `document_id`, `chunk_index`, `content`, `distance`, `similarity`.

Edge cases:

- Empty query → validation error
- Very large `limit` → server should clamp or handle accordingly

---

## 🧠 Memory & RAG Behaviour (summary)

- Personal facts are stored as `memory_type = 'fact'` keyed by `memory_key` (upserted).
- Chat history turns append with `memory_type = 'chat'`.
- Both facts and chats have embeddings stored in `user_memories.embedding` for retrieval.
- RAG uses `chunks.embedding` with an ivfflat index for fast vector search.

---

## ✅ Project Goals & Quality Checklist

Make sure the following are satisfied before E2E testing:

- **Clean Code**
  - Follow TypeScript best practices and code organization (Clean Architecture).
  - Avoid `any` where precise types possible.

- **Error Handling**
  - Ensure .env keys present (OPENAI_API_KEY).
  - Verify DB connectivity and pool sizing.
  - Test for invalid API keys and DB failures to confirm graceful errors.

- **Documentation**
  - This README provides installation, DB setup, env, endpoint examples and E2E curls.

---

## Troubleshooting tips

- If `npx tsc --noEmit` fails, run `npm install` to ensure dev dependencies (typescript) are present.
- If vector index creation fails, ensure `pgvector` is installed in the PostgreSQL instance and that the `vector` extension is enabled in the DB.
- When embedding calls fail due to API limits, check `OPENAI_TIMEOUT_MS` and your API quota.

---

## Contact / Next Steps

- Run the DB schema and ingest `docs/policy.md` (the policy document included in repo) before running combined personalized RAG queries.
- For production, secure environment variables (use secret manager) and set proper retention for `user_memories` or archiving policies.

---

_This README is generated to match the current codebase and schema. It preserves all runtime shapes and behaviour; only documentation is added/updated._
