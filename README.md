📦 RAG Agent — Vector Search Chatbot (Node.js + PostgreSQL + OpenAI)

This project is a Retrieval-Augmented Generation (RAG) Proof of Concept demonstrating:

Markdown ingestion

Text chunking

Embedding generation using OpenAI

Storing vectors in PostgreSQL with pgvector

Similarity search for relevant context

Chat endpoint generating responses based on stored chunks

Designed to pass technical assessment requirements for backend AI engineer / RAG system developer.

🚀 Features

Upload & process Markdown files via API

Automatically chunk and embed content

Store embeddings in PostgreSQL pgvector

Retrieve relevant chunks using vector similarity search (<->)

Chat endpoint that answers based on retrieved context

Returns both answer & context used

Fully local backend service (no UI required)

🏗 Tech Stack
Component Technology
Runtime Node.js / TypeScript
Web Framework Express.js
Database PostgreSQL + pgvector
LLM Provider OpenAI
Embeddings Model text-embedding-3-small
Chat Model gpt-4o-mini
Vector Dimension 1536
📁 Project Structure
src/
├── routes/
│ ├── ingest.ts # Upload, chunk, embed & store document
│ └── chat.ts # Answer questions using RAG
├── service/
│ ├── embedding.ts
│ └── mastraAgent.ts # Base LLM wrapper
├── utils/
│ └── db.ts # PostgreSQL / pgvector config
├── scripts/
│ └── testLLM.ts # Manual agent test script

🔑 Environment Variables

Create a .env file at project root:

DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=postgres
DB_NAME=rag_agent

OPENAI_API_KEY=yourapikey

🛠 Setup Instructions

1. Install Dependencies
   npm install

2. PostgreSQL & pgvector Setup (if not done yet)
   CREATE DATABASE rag_agent;
   CREATE EXTENSION IF NOT EXISTS vector;

Tables:

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

3. Start Backend
   npm run dev

Server default runs at:

http://127.0.0.1:3000

📥 Ingest Markdown File via cURL

Run inside Ubuntu terminal (WSL recommended)

curl -X POST http://127.0.0.1:3000/api/ingest \
-H "Content-Type: application/json" \
-d '{"filepath":"/mnt/d/self/rag-agent-project/docs/policy.md"}'

Example Output
{"status":"ok","documentId":1,"chunks":3}

💬 Ask a Question (Chat RAG)
curl -X POST http://127.0.0.1:3000/api/chat \
-H "Content-Type: application/json" \
-d '{"question":"What is this document about?"}'

Example Output
{
"answer":"It is a demo test document about RAG ingestion.",
"contextUsed":[
{
"content": "Hello World...quick brown fox...",
"distance": 1.15
}
]
}

🧪 Test the Agent
npx ts-node ./src/scripts/testLLM.ts

Expected output:

=== AgentResponse ===
answer: The quick brown fox.
rawPresent: true

🏁 Project Status
Requirement Status
Ingestion pipeline ✔ Done
Chunk + Embed + Store ✔ Done
Vector similarity search ✔ Done
Chat endpoint with RAG ✔ Done
Return answer + context used ✔ Done
Optional: History-aware RAG ⏳ Not required
🎉 All required technical test criteria are completed.
📦 Next Improvements (Optional / Bonus)
Feature Benefit
History-aware multi-turn chat More realistic Q&A
Frontend UI chat Better UX
Reranker (colBERT / bge-rerank) Better accuracy
Hybrid search BM25 + vectors Improves retrieval on long docs
👨‍💻 Author

Aditia Farhan — Software Engineer | AI & RAG Backend Developer
