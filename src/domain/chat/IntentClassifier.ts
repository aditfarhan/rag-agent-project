/**
 * Intent classification system for conversational AI agent.
 *
 * Analyzes user messages to determine intent and extract personal facts:
 * - Detects whether user is asking about memory vs policy vs unknown
 * - Extracts dynamic key-value facts from natural language
 * - Uses pattern matching and LLM classification for robust understanding
 *
 * Critical component for the RAG + Mastra AI agent architecture, enabling
 * context-aware responses by distinguishing memory queries from policy questions.
 */
import { callLLM } from "@infra/llm/OpenAIAdapter";

export type HighLevelIntent =
  | "PURE_MEMORY_QUERY"
  | "PURE_POLICY_QUERY"
  | "MERGED_MEMORY_POLICY_QUERY"
  | "UNKNOWN";

export const POLICY_REGEX =
  /policy|company|work|acceptable|allowed|forbidden|break|rule|regulation/i;

export const PERSONAL_QUESTION_REGEX =
  /^do i (own|have|like|prefer|remember|know)|^am i\b/i;

export const MEANINGFUL_TOKENS = new Set<string>([
  // Question words indicating genuine user intent
  "what",
  "why",
  "how",
  "when",
  "where",
  "who",
  // Modal verbs for policy/personal inquiries
  "can",
  "should",
  "could",
  "would",
  "is",
  "are",
  "do",
  "does",
  "did",
  "may",
  "might",
  // Domain-specific terms for RAG context
  "policy",
  "office",
  "coffee",
  "tea",
  "break",
  "name",
  // Memory-related identifiers
  "own",
  "have",
  "like",
  "prefer",
  "work",
]);

export async function extractDynamicKeyFact(userMessage: string): Promise<{
  key: string;
  value: string;
  intent: "introducing" | "asking" | "updating" | "neutral";
} | null> {
  const prompt = `
You are a fact extraction and intent classification engine.

Return STRICT JSON in this format ONLY:
{
  "key": "string",
  "value": "string",
  "intent": "introducing" | "updating" | "asking" | "neutral"
}

Intent definitions:
- introducing: user provides a new personal fact
- updating: user modifies an existing fact
- asking: user asks about their own stored fact
- neutral: no personal fact involved

Examples:
"My name is Aditia" -> { "key": "name", "value": "Aditia", "intent": "introducing" }
"My name is now Budi" -> { "key": "name", "value": "Budi", "intent": "updating" }
"Who am I?" -> { "key": "name", "value": "", "intent": "asking" }
"Hello there" -> null

User message: "${userMessage}"
`;

  const response = await callLLM(prompt, "", []);

  try {
    const firstBrace = response.indexOf("{");
    const jsonText = firstBrace >= 0 ? response.slice(firstBrace) : response;
    const fact = JSON.parse(jsonText);

    if (fact?.key && typeof fact.intent === "string") {
      return {
        key: String(fact.key).toLowerCase(),
        value: String(fact.value || ""),
        intent: fact.intent,
      };
    }
  } catch (err: unknown) {
    const candidate = err as { message?: unknown };
    const message =
      typeof candidate.message === "string" ? candidate.message : undefined;
  }

  return null;
}

export function detectHighLevelIntent(
  question: string,
  keyFact: {
    key: string;
    intent: "introducing" | "asking" | "updating" | "neutral";
  } | null,
  hasPolicyKeyword: boolean,
  isDirectPersonalQuestion: boolean
): HighLevelIntent {
  if (keyFact?.intent === "asking") {
    if (hasPolicyKeyword) {
      return "MERGED_MEMORY_POLICY_QUERY";
    }
    return "PURE_MEMORY_QUERY";
  }

  if (!keyFact && isDirectPersonalQuestion) {
    return "PURE_MEMORY_QUERY";
  }

  if (hasPolicyKeyword) {
    return "PURE_POLICY_QUERY";
  }

  return "UNKNOWN";
}

export function isGarbageQuestion(text: string): boolean {
  const cleaned = text.trim();
  if (!cleaned) return true;
  if (cleaned.length < 4) return true;

  const alphaMatches = cleaned.match(/[a-zA-Z]/g) || [];
  const hasDigit = /\d/.test(cleaned);
  const punctMatches = cleaned.match(/[?!]/g) || [];
  const manyPunct = punctMatches.length >= 2;

  const tokens = cleaned
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/[^a-z]/g, ""))
    .filter(Boolean);

  const meaningful = tokens.some((t) => MEANINGFUL_TOKENS.has(t));

  if (!meaningful && (hasDigit || manyPunct) && alphaMatches.length < 20) {
    return true;
  }

  return false;
}
