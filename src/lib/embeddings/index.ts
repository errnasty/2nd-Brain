import { EMBEDDING_DIMS } from "@/lib/db/schema";

export type EmbeddingInputType = "document" | "query";

export interface EmbeddingsProvider {
  name: string;
  model: string;
  dims: number;
  /** Embed a batch of strings. Inputs are truncated to a safe per-item budget by the caller. */
  embed(texts: string[], inputType?: EmbeddingInputType): Promise<number[][]>;
}

/** Lazily resolve the provider so missing keys don't crash unrelated code paths. */
export function getEmbeddingsProvider(): EmbeddingsProvider {
  const provider = (process.env.EMBEDDINGS_PROVIDER ?? "openai").toLowerCase();
  switch (provider) {
    case "openai":
      return openaiEmbeddings();
    case "voyage":
      return voyageEmbeddings();
    default:
      throw new Error(`Unknown EMBEDDINGS_PROVIDER: ${provider}`);
  }
}

// ── OpenAI ───────────────────────────────────────────────────────────
// text-embedding-3-small natively returns 1536 dims but supports `dimensions`
// truncation to match our 1024-dim pgvector column (which matches Voyage native).

function openaiEmbeddings(): EmbeddingsProvider {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.EMBEDDINGS_MODEL ?? "text-embedding-3-small";
  return {
    name: "openai",
    model,
    dims: EMBEDDING_DIMS,
    async embed(texts /* inputType is ignored — OpenAI's space is symmetric */) {
      if (!apiKey) throw new Error("OPENAI_API_KEY not configured");
      if (texts.length === 0) return [];
      const res = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model, input: texts, dimensions: EMBEDDING_DIMS }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`OpenAI embeddings ${res.status}: ${text.slice(0, 200)}`);
      }
      const data = (await res.json()) as { data: Array<{ embedding: number[] }> };
      return data.data.map((d) => d.embedding);
    },
  };
}

// ── Voyage AI ────────────────────────────────────────────────────────
// Anthropic's documented embeddings partner. voyage-3-large is their best model;
// 1024 dims native, matches our schema exactly. No output_dimension override needed.

function voyageEmbeddings(): EmbeddingsProvider {
  const apiKey = process.env.VOYAGE_API_KEY;
  const model = process.env.EMBEDDINGS_MODEL ?? "voyage-3-large";
  return {
    name: "voyage",
    model,
    dims: EMBEDDING_DIMS,
    async embed(texts, inputType = "document") {
      if (!apiKey) throw new Error("VOYAGE_API_KEY not configured");
      if (texts.length === 0) return [];
      const res = await fetch("https://api.voyageai.com/v1/embeddings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          input: texts,
          input_type: inputType,
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Voyage embeddings ${res.status}: ${text.slice(0, 200)}`);
      }
      const data = (await res.json()) as { data: Array<{ embedding: number[] }> };
      return data.data.map((d) => d.embedding);
    },
  };
}

// ── Helpers ──────────────────────────────────────────────────────────

/** Trim a long string for embedding. OpenAI accepts up to ~8k tokens; keep well under. */
export function clampForEmbedding(text: string, maxChars = 8000): string {
  if (!text) return "";
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars);
}

/** Convert a number[] to the literal pgvector string format Postgres expects: `[0.1,0.2,...]`. */
export function toVectorLiteral(v: number[]): string {
  return `[${v.join(",")}]`;
}
