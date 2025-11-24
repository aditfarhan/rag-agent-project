export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export type ChatHistory = ChatMessage[];
