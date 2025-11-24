import { client } from "./openAIClient.ts";

export async function embedText(text: string): Promise<number[]> {
  const response = await client.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });

  const first = response.data[0];

  if (!first || !first.embedding) {
    throw new Error("Embedding API returned invalid data");
  }

  const emb = first.embedding;
  return emb;
}
