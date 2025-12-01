# RAG Agent — Vector Search Chatbot (Node.js + TypeScript)

A production-ready Retrieval-Augmented Generation (RAG) backend with:

- Chat orchestration with long-term memory & policy reasoning
- Markdown ingestion & chunking
- Embedding generation via OpenAI‑compatible APIs
- PostgreSQL + pgvector vector search
- Semantic search and RAG-based answering

The system follows a strict Clean Architecture structure and includes robust error handling, logging, and strongly typed TypeScript modules.

---

# 📦 Project Structure

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

# 🛠 Installation

```bash
git clone <repo-url>
cd rag-agent-project
npm install
```

Ensure **Node.js ≥ 20**, **PostgreSQL ≥ 15**, and `pgvector` extension.

---

# 🗄 Database Setup (FULL SCHEMA + INDEXES + TRIGGERS)

Connect to PostgreSQL:

```bash
psql -U postgres
```

Create database:

```sql
CREATE DATABASE rag_agent;
\c rag_agent;
CREATE EXTENSION IF NOT EXISTS vector;
```

---

## 📘 Table: documents

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

---

## 📘 Table: chunks

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

CREATE INDEX idx_chunks_embedding
  ON chunks USING ivfflat (embedding) WITH (lists = 100);
```

---

## 📘 Table: user_memories

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

CREATE INDEX idx_user_memories_user_id
  ON user_memories (user_id);
```

---

# 🔁 Trigger Function (Standard)

```sql
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

Attach trigger:

```sql
CREATE TRIGGER update_user_memories_timestamp
BEFORE UPDATE ON user_memories
FOR EACH ROW EXECUTE FUNCTION update_timestamp();
```

---

# 🚀 Running the Service

### Development

```bash
npm run dev
```

### Production

```bash
npm run build
npm start
```

---

# 🌐 API Endpoints

## 1. Health Check

```bash
curl -X GET http://localhost:3000/api/health
```

---

## 2. Ingest Markdown File

```bash
curl -X POST http://localhost:3000/api/documents/ingest   -H "Content-Type: application/json"   -d '{"filepath":"./docs/policy.md","title":"HR Policy"}'
```

---

# 3. Chat — Personalized Memory Example

### Store user personal preference ("Farhan likes coffee and football")

```bash
curl -X POST http://localhost:3000/api/chat   -H "Content-Type: application/json"   -d '{
    "userId": "farhan",
    "question": "My name is Farhan",
    "history":[]
  }'
```

```bash
curl -X POST http://localhost:3000/api/chat   -H "Content-Type: application/json"   -d '{
    "userId": "farhan",
    "question": "I love strong black coffee and playing football.",
    "history":[]
  }'
```

### Ask for personalized response

```bash
curl -X POST http://localhost:3000/api/chat   -H "Content-Type: application/json"   -d '{
    "userId":"farhan",
    "question":"What do you remember about me?",
    "history":[]
  }'
```

---

# 4. Chat — Work Policy Question (Pulls from RAG)

```bash
curl -X POST http://localhost:3000/api/chat   -H "Content-Type: application/json"   -d '{
    "userId":"farhan",
    "question":"What does the employee policy say about working hours?",
    "history":[]
  }'
```

---

# 5. Combined Personalized + Policy Question

```bash
curl -X POST http://localhost:3000/api/chat   -H "Content-Type: application/json"   -d '{
    "userId":"farhan",
    "question":"Considering that I love football, how should I manage my schedule according to the company working hours?",
    "history":[]
  }'
```

---

# 6. Internal Semantic Search (debug endpoint)

```bash
curl -X POST http://localhost:3000/api/internal/search   -H "Content-Type: application/json"   -d '{"query": "annual leave policy", "limit": 5}'
```

---

# 🧠 Memory Behavior Summary

- Fact memories (identity, preferences) are upserted using `memory_key`.
- Chat memories are appended.
- Embeddings stored in `user_memories.embedding` enable similarity retrieval.
- RAG context is automatically combined with memory context in chat responses.

---

# 📚 Documentation: Project Goals

This project satisfies the required objectives:

### ✔ Clean TypeScript Code

Strong typing, no `any`, Clean Architecture boundaries, ESLint + Prettier enforced.

### ✔ Robust Error Handling

- Centralized middleware
- LLM error retries
- DB connectivity protection
- Config validation

### ✔ Complete Documentation

Installation, database setup, endpoint usage, and examples are included.

---

# 🎉 Done

This README contains the full authoritative documentation for running the RAG Agent service with the latest schema and logic.
