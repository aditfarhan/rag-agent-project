# Architecture Overview

This document describes the current, finalized architecture of the RAG Agent backend after the refactor. It does **not** introduce any new behaviour or APIs; it only documents the existing structure.

The system follows a Clean Architecture / hexagonal layout with clear separation between:

- **Interfaces / HTTP** (controllers, schemas, DTOs)
- **Application** (use-cases)
- **Domain** (business logic + ports)
- **Infrastructure** (adapters for DB, LLM, logging)
- **Cross-cutting** (`config`, `core/logging`, `utils`, `middleware`, `routes`)

---

## High-Level Diagram

```mermaid
flowchart LR
  Client[Client / API Consumer] --> HTTP[Interfaces / HTTP Layer]

  subgraph HTTP[Interfaces / HTTP]
    CChat[ChatController.ts]
    CIngest[IngestController.ts]
    CSearch[SearchController.ts]
    Schemas[Zod Schemas + DTOs]
  end

  HTTP --> Routes[Express Routes]
  Routes --> App[Application Layer (Use-Cases)]

  subgraph App[Application Layer]
    UCChat[ChatUseCase.ts\nhandleChat]
    UCIngest[IngestUseCase.ts\ningestDocument]
    UCSearch[SearchUseCase.ts\nsearchDocumentsByText]
  end

  App --> Domain[Domain Layer]
  App --> Ports[Domain Ports]

  subgraph Domain[Domain Logic + Ports]
    DChat[IntentClassifier.ts\n(intent detection, garbage check)]
    DMem[memoryManager.ts\n(memory save/retrieve)]
    DRag[ragEngine.ts\n(RAG context + search)]
    PortsMem[MemoryRepository Port]
    PortsRag[RagRepository Port]
    PortsLLM[LLM Port]
  end

  Domain --> Infra[Infrastructure Layer]

  subgraph Infra[Infrastructure Layer]
    DB[Postgres / pgvector\n(db.ts, PostgresMemoryRepository.ts,\nPgVectorRagRepository.ts)]
    LLM[OpenAIAdapter.ts\n(Mastra agent + OpenAI client)]
    Emb[EmbeddingProvider.ts\n(embedText, embedBatch)]
    Log[Logger.ts\n(file + console logger)]
  end

  Infra --> Core[Core Logging Port]
  Core --- Utils[Utils (logger shim, vector helpers)]

  subgraph Core[Core]
    LogPort[core/logging/index.ts\nLoggerPort]
  end

  subgraph Utils[Utils]
    ULogger[utils/logger.ts\n(logger, logEvent shim)]
    UVector[utils/vector.ts\npgvector helpers]
  end

  subgraph Config[Config + Types]
    Cfg[src/config/index.ts]
    CfgMem[src/config/memoryKeys.ts]
    Types[src/types/*.ts]
  end

  Routes -. uses .-> Middleware[errorHandler.ts]
  Middleware --> Log

  Config --> App
  Config --> Domain
  Config --> Infra
```

---

## Layer Responsibilities

### Interfaces / HTTP

Location:

- `src/interfaces/http/*.ts`
- `src/interfaces/http/*/schema.ts`
- `src/interfaces/http/dto/*.ts`
- `src/routes/**/*.ts`
- `src/server.ts`
- `src/middleware/errorHandler.ts`

Responsibilities:

- Accept HTTP requests (Express).
- Validate requests and responses using Zod schemas.
- Map HTTP DTOs to application input types.
- Call application-level use-cases.
- Return JSON responses using the established shapes.

Constraints:

- Controllers must not contain business logic.
- Controllers must not talk directly to DB or LLM; they only call use-cases.
- Error handling is centralized in `middleware/errorHandler.ts`.

---

### Application Layer (Use-Cases)

Location:

- `src/app/chat/ChatUseCase.ts`
- `src/app/ingest/IngestUseCase.ts`
- `src/app/search/SearchUseCase.ts`

Responsibilities:

- Orchestrate domain logic to fulfill a use-case:
  - Chat:
    - Combine intent detection, memory, and RAG.
    - Call LLM with constructed prompts.
  - Ingest:
    - Normalize markdown.
    - Chunk and embed text.
    - Insert/update DB records.
  - Search:
    - Validate query.
    - Embed query.
    - Call domain RAG search.

Constraints:

- No Express imports.
- No direct SQL or low-level HTTP calls.
- Interact only with domain ports and infrastructure services via typed functions.

---

### Domain Layer (Logic + Ports)

Location:

- `src/domain/chat/IntentClassifier.ts`
- `src/domain/memory/memoryManager.ts`
- `src/domain/memory/ports.ts`
- `src/domain/rag/ragEngine.ts`
- `src/domain/rag/ports.ts`
- `src/domain/llm/ports.ts`

Responsibilities:

- Pure business logic:
  - Intent detection, garbage filtering, key fact extraction.
  - Memory save/retrieve policies and scoring.
  - RAG context assembly, semantic search logic.

- Ports:
  - `MemoryRepository` (abstract persistence for memories).
  - RAG repository port (vector retrieval over chunks).
  - `LLMPort` (abstract LLM interface).

Constraints:

- Must not import Express or concrete DB/LLM clients.
- Allowed to import:
  - Config (read-only configuration)
  - Ports from `domain/*/ports.ts`
  - Pure utilities (e.g., vector helpers if they remain pure)

---

### Infrastructure Layer (Adapters)

Location:

- `src/infrastructure/database/db.ts`
- `src/infrastructure/database/PostgresMemoryRepository.ts`
- `src/infrastructure/database/PgVectorRagRepository.ts`
- `src/infrastructure/llm/OpenAIAdapter.ts`
- `src/infrastructure/llm/EmbeddingProvider.ts`
- `src/infrastructure/logging/Logger.ts`

Responsibilities:

- Provide concrete implementations for domain ports and infra concerns:
  - PostgreSQL + pgvector for documents and memories.
  - OpenAI/Mastra agent configuration and retry handling.
  - Embedding generation endpoints.
  - Logging to console + file.

Constraints:

- Must not depend on Express.
- Must implement contracts exposed via domain ports and core logging.
- Must not change prompts, thresholds, or business logic semantics.

---

### Cross-Cutting Modules

- **Config** — `src/config/index.ts`, `src/config/memoryKeys.ts`  
  Provides environment-driven configuration and constants used across layers.

- **Core Logging** — `src/core/logging/index.ts`  
  Defines `LoggerPort` used by domain and infrastructure.

- **Utils** — `src/utils/logger.ts`, `src/utils/vector.ts`
  - `logger.ts` re-exports the infrastructure logger for legacy paths and convenience.
  - `vector.ts` provides pgvector utilities (string literal conversion).

- **Types** — `src/types/*.ts`  
  Shared error types and internal meta types (`ChatMeta`).

---

## Notes

- The diagram above represents the **current** project structure, after refactoring but before any new features.
- All HTTP routes, JSON response shapes, prompts, thresholds, and behavioural semantics remain identical to the original implementation.
- `docs/architecture.png` is reserved for a rendered version of this diagram (for example, exporting the Mermaid diagram from this file).
