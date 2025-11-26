// src/service/mastraAgent.ts
// Backwards-compatible wrapper that re-exports the core Mastra agent.
//
// This preserves existing import paths (../service/mastraAgent) while the
// actual implementation and configuration live in the core layer:
//   src/core/mastraAgent.ts
//
// The core module uses the centralized config abstraction exclusively and
// adds structured logging and error classification.

export { mastra, callLLM } from "../core/mastraAgent";
