import { EMBEDDING_DIMS } from "@/lib/db/schema";

export type EmbeddingInputType = "document" | "query";

export interface EmbeddingsProvider {
  name: string;
  model: string;
  dims: number;
  /** Embed a batch of strings. Inputs are truncated to a safe per-item budget by the caller. */
  embed(texts: string[], inputType?: EmbeddingInputType): Promise<number[][]>;
}

// The provider object is immutable for a given process (it only reads env at
// construction). getEmbeddingsProvider() runs on every embed + RAG call, so
// build it once and reuse instead of re-allocating closures + re-reading env
// each time. Provider choice is fixed at startup; switching requires a restart.
let cachedProvider: EmbeddingsProvider | null = null;

/** Lazily resolve the provider so missing keys don't crash unrelated code paths. */
export function getEmbeddingsProvider(): EmbeddingsProvider {
  if (cachedProvider) return cachedProvider;
  const provider = (process.env.EMBEDDINGS_PROVIDER ?? "openai").toLowerCase();
  switch (provider) {
    case "openai":
      cachedProvider = openaiEmbeddings();
      break;
    case "voyage":
      cachedProvider = voyageEmbeddings();
      break;
    case "local":
      cachedProvider = localEmbeddings();
      break;
    default:
      throw new Error(`Unknown EMBEDDINGS_PROVIDER: ${provider}`);
  }
  return cachedProvider;
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

// ── Local (offline) via @xenova/transformers ────────────────────────
// Runs an ONNX model in-process (WASM) with NO network calls — useful for
// local dev or air-gapped use. Default model bge-large-en-v1.5 outputs 1024
// dims, matching the schema, so it's interchangeable with Voyage at the DB
// level.
//
// IMPORTANT CAVEATS:
//  - Vectors from different models are NOT comparable. If you switch a library
//    that was embedded with Voyage/OpenAI over to `local`, you must re-embed
//    everything (clear + backfill) or search results will be garbage. For this
//    reason `local` is a deliberate provider CHOICE, not a silent auto-fallback.
//  - The model (~130MB quantized) downloads on first use and needs memory +
//    time that typically exceed serverless function limits. Best for local dev
//    or a long-lived self-hosted Node process.

let localPipelinePromise: Promise<(text: string, opts: object) => Promise<{ data: Float32Array }>> | null =
  null;

function localEmbeddings(): EmbeddingsProvider {
  const model = process.env.EMBEDDINGS_MODEL ?? "Xenova/bge-large-en-v1.5";
  return {
    name: "local",
    model,
    dims: EMBEDDING_DIMS,
    async embed(texts) {
      if (texts.length === 0) return [];
      if (!localPipelinePromise) {
        // Dynamic import keeps the heavy WASM runtime out of the bundle unless
        // the local provider is actually selected.
        localPipelinePromise = import("@xenova/transformers").then(async (mod) => {
          // Allow remote model download (set TRANSFORMERS_OFFLINE=1 to require
          // a pre-cached model for truly offline use).
          return (await mod.pipeline("feature-extraction", model)) as unknown as (
            text: string,
            opts: object,
          ) => Promise<{ data: Float32Array }>;
        });
      }
      const extractor = await localPipelinePromise;
      const out: number[][] = [];
      // Process sequentially — the WASM model isn't meaningfully parallel.
      for (const text of texts) {
        const result = await extractor(text, { pooling: "mean", normalize: true });
        out.push(Array.from(result.data));
      }
      return out;
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
